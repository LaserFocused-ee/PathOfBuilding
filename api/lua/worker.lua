-- Path of Building API worker: boots Path of Building headless in this Lua state and serves
-- one build over JSON lines (stdin requests, stdout responses). Replaces src/HeadlessWrapper.lua
-- without editing it. Run with cwd = <checkout>/src:
--   LUA_PATH='../runtime/lua/?.lua;../runtime/lua/?/init.lua' LUA_CPATH='<rt>/?.so' luajit <checkout>/api/lua/worker.lua
-- Env: POB_STATE_DIR (writable directory outside the checkout; user and build paths point here).
-- Protocol: request {id, op, args}; response {id, ok:true, result, warnings} or {id, ok:false, error:{code,message}, warnings}.
-- The first line written is {ready:true, ...} after boot, or {ready:false, error} before exit.
package.path = "./?.lua;../runtime/lua/?.lua;../runtime/lua/?/init.lua;" .. package.path
local ffi = require("ffi")
local json = require("dkjson")

local stdout, stderr = io.stdout, io.stderr
local stateDir = os.getenv("POB_STATE_DIR") or error("POB_STATE_DIR is required")
local here = debug.getinfo(1, "S").source:match("^@(.*)/[^/]*$") or "."

-- Everything Path of Building prints goes to stderr; stdout carries protocol lines only.
print = function(...)
	local t = { ... }
	for i = 1, select("#", ...) do t[i] = tostring(t[i]) end
	stderr:write(table.concat(t, "\t"), "\n")
end
local function send(obj)
	stdout:write(json.encode(obj), "\n")
	stdout:flush()
end

-- zlib through the FFI (the system libz.so.1), same contract as SimpleGraphic's Inflate/Deflate.
ffi.cdef[[
typedef struct z_stream_s {
  const unsigned char *next_in; unsigned int avail_in; unsigned long total_in;
  unsigned char *next_out; unsigned int avail_out; unsigned long total_out;
  const char *msg; void *state; void *zalloc; void *zfree; void *opaque;
  int data_type; unsigned long adler; unsigned long reserved;
} z_stream;
const char *zlibVersion(void);
int deflateInit2_(z_stream *s, int level, int method, int windowBits, int memLevel, int strategy, const char *version, int stream_size);
int deflate(z_stream *s, int flush);
int deflateEnd(z_stream *s);
int inflateInit2_(z_stream *s, int windowBits, const char *version, int stream_size);
int inflate(z_stream *s, int flush);
int inflateEnd(z_stream *s);
typedef struct { long tv_sec; long tv_nsec; } pobw_timespec;
int clock_gettime(int clk, pobw_timespec *ts);
]]
local okZ, Z = pcall(ffi.load, "z")
if not okZ then Z = ffi.load("libz.so.1") end -- Alpine names it only by soname
local Z_OK, Z_STREAM_END, Z_BUF_ERROR, Z_FINISH = 0, 1, -5, 4

local function zrun(step, s, input)
	local inbuf = ffi.new("unsigned char[?]", #input)
	ffi.copy(inbuf, input, #input)
	s.next_in, s.avail_in = inbuf, #input
	local chunk, out = 65536, {}
	local obuf = ffi.new("unsigned char[?]", chunk)
	while true do
		s.next_out, s.avail_out = obuf, chunk
		local rc = step(s, Z_FINISH)
		out[#out + 1] = ffi.string(obuf, chunk - s.avail_out)
		if rc == Z_STREAM_END then return table.concat(out) end
		if rc ~= Z_OK and rc ~= Z_BUF_ERROR then
			return nil, "zlib error " .. rc .. (s.msg ~= nil and (": " .. ffi.string(s.msg)) or "")
		end
		if rc == Z_BUF_ERROR and s.avail_in == 0 and s.avail_out ~= 0 then return nil, "truncated input" end
	end
end
local function zDeflate(data, isGzip)
	local s = ffi.new("z_stream")
	if Z.deflateInit2_(s, 9, 8, isGzip and 31 or 15, 8, 0, Z.zlibVersion(), ffi.sizeof(s)) ~= Z_OK then return nil, "deflateInit failed" end
	local out, err = zrun(Z.deflate, s, data)
	Z.deflateEnd(s)
	return out, err
end
local function zInflate(data)
	if type(data) ~= "string" then return nil, "no data" end
	local s = ffi.new("z_stream")
	if Z.inflateInit2_(s, 47, Z.zlibVersion(), ffi.sizeof(s)) ~= Z_OK then return nil, "inflateInit failed" end
	local out, err = zrun(Z.inflate, s, data)
	Z.inflateEnd(s)
	return out, err
end
local function nowMs()
	local ts = ffi.new("pobw_timespec")
	ffi.C.clock_gettime(1, ts) -- CLOCK_MONOTONIC
	return tonumber(ts.tv_sec) * 1000 + math.floor(tonumber(ts.tv_nsec) / 1e6)
end

-- Host API: stubs first, then the overrides that matter (same seam as HeadlessWrapper.lua:8-32).
dofile("_SimpleGraphic.def.lua")
Inflate, Deflate, GetTime = zInflate, zDeflate, nowMs
GetUserPath = function() return stateDir end
GetRuntimePath = function() return stateDir end
-- GetScriptPath stays "" (upstream headless value): data loaders build paths relative to cwd = src from it.
local copied
Copy = function(text) copied = text end
Paste = function() return nil end
-- The ways out of the Lua state: sub-scripts (Launch.lua's downloads), links, and files written outside the state dir.
-- None of them goes anywhere: a write outside the state dir is refused as a failed open (Path of Building's own callers
-- already handle that, e.g. the timeless jewel data loader's uncompressed cache in src/Data). Each is counted so a test
-- can show what a control reached (`worker.reach`).
local reach = { subScripts = 0, urls = 0, writes = {} }
LaunchSubScript = function() reach.subScripts = reach.subScripts + 1; return nil end
OpenURL = function() reach.urls = reach.urls + 1 end
local l_open, l_remove, l_rename = io.open, os.remove, os.rename
local function outside(path)
	local p = tostring(path)
	return p:sub(1, #stateDir + 1) ~= stateDir .. "/" or p:find("..", 1, true) ~= nil
end
local function refuse(path)
	reach.writes[#reach.writes + 1] = tostring(path)
	return nil, tostring(path) .. ": writes outside the state directory are refused"
end
io.open = function(path, mode)
	if mode and mode:find("[wa+]") and outside(path) then return refuse(path) end
	return l_open(path, mode)
end
os.remove = function(path)
	if outside(path) then return refuse(path) end
	return l_remove(path)
end
os.rename = function(from, to)
	if outside(from) or outside(to) then return refuse(to) end
	return l_rename(from, to)
end
function GetVirtualScreenSize() return 1920, 1080 end
__callbackTable__ = {}
function runCallback(name, ...)
	if __callbackTable__[name] then
		return __callbackTable__[name](...)
	elseif __mainObject__ and __mainObject__[name] then
		return __mainObject__[name](__mainObject__, ...)
	end
end
local l_require = require
function require(name)
	if name == "lcurl.safe" then return end -- network belongs to the host process
	return l_require(name)
end
arg = {} -- Main.lua:68 imports a URL from arg[1]

local t0 = nowMs()
dofile("Launch.lua")
runCallback("OnInit")
runCallback("OnFrame")
local launch = __mainObject__
local main = launch.main
if not main then
	send({ ready = false, error = { code = "worker_error", message = StripEscapes(tostring(launch.promptMsg)) } })
	os.exit(1)
end
-- The item databases load in OnFrame coroutines that yield on real time; finish them now.
for _ = 1, 500 do
	if not (main.uniqueDB.loading or main.rareDB.loading) then break end
	runCallback("OnFrame")
end
if launch.promptMsg or main.uniqueDB.loading or main.rareDB.loading then
	send({ ready = false, error = { code = "worker_error", message = StripEscapes(launch.promptMsg or "item databases did not finish loading") } })
	os.exit(1)
end
main.disableDevAutoSave = true
main.userPath = stateDir .. "/"
main.buildPath = stateDir .. "/Builds/"

-- ConfigTab:Save writes an input only when it differs from its default (0 for numbers), so a countAllowZero override
-- of 0 (inspiration charges, sigil stages, enemy resistances) was dropped on save, duplicate and export and read back
-- as the computed value. During Save those options have no default, so every input of theirs is written.
do
	if not common.classes.ConfigTab then LoadModule("Classes/ConfigTab") end
	local class, allowZero = common.classes.ConfigTab, {}
	for _, varData in ipairs(require("Modules.ConfigOptions")) do
		if varData.type == "countAllowZero" then allowZero[varData.var] = true end
	end
	local save, default = class.Save, class.GetDefaultState
	function class:Save(xml)
		self.GetDefaultState = function(tab, var, varType)
			if allowZero[var] then return nil end
			return default(tab, var, varType)
		end
		local ok, err = pcall(save, self, xml)
		self.GetDefaultState = nil
		if not ok then error(err, 0) end
	end
end

-- Shared helpers for ops/<domain>.lua.
local W = { json = json, inflate = zInflate, deflate = zDeflate, now = nowMs, main = main, launch = launch }

function W.fail(code, message)
	error({ code = code, message = message }, 0)
end
function W.strip(s)
	return type(s) == "string" and StripEscapes(s) or s
end
-- The nodes allocating `node` takes, as PassiveSpec:AllocNode does: the node alone when a Thread of Hope or Impossible
-- Escape lets it be allocated without a connection (intuitiveLeapLikesAffecting), otherwise its path.
function W.allocPath(node)
	if node.intuitiveLeapLikesAffecting and #node.intuitiveLeapLikesAffecting > 0 then return { node } end
	return node.path
end
-- Item text from the trade site can leave out a unique jewel's "Radius:" line. Without it Path of Building gives the
-- jewel no radius, so a timeless or radius jewel changes nothing. The line is taken from the unique list's own item.
function W.withUniqueRadius(text)
	if type(text) ~= "string" or text:match("\nRadius: ") then return text end
	local _, at, title, base = text:find("Rarity: [Uu][Nn][Ii][Qq][Uu][Ee]\r?\n([^\r\n]+)\r?\n([^\r\n]+)")
	local unique = title and main.uniqueDB.list[title .. ", " .. base]
	if not unique or not unique.jewelRadiusLabel then return text end
	return text:sub(1, at) .. "\nRadius: " .. unique.jewelRadiusLabel .. text:sub(at + 1)
end
-- The lines a Tooltip would draw, colour codes stripped; a separator becomes one "" between two text lines.
function W.tooltip(fn)
	local t = new("Tooltip"):Tooltip()
	fn(t)
	local list = setmetatable({}, { __jsontype = "array" })
	for _, line in ipairs(t.lines) do
		if line.text then
			list[#list + 1] = W.strip(line.text)
		elseif #list > 0 and list[#list] ~= "" then
			list[#list + 1] = ""
		end
	end
	if list[#list] == "" then list[#list] = nil end
	return list
end
function W.build()
	local b = main.modes.BUILD
	if main.mode ~= "BUILD" or not b.calcsTab or not b.calcsTab.mainOutput then
		error({ code = "worker_error", message = "no build is loaded in this worker", notLoaded = true }, 0)
	end
	return b
end
-- Pump frames until pending mode switches and recalculations are done (Build.lua:1258 runs on OnFrame).
function W.pump()
	for _ = 1, 50 do
		runCallback("OnFrame")
		local b = main.modes.BUILD
		if not main.newMode and not (main.mode == "BUILD" and b.buildFlag) then return end
	end
	W.fail("worker_error", "build did not settle after 50 frames")
end
-- JSON-safe copy: drops functions and cycles, strips colour codes, bounds depth.
function W.plain(v, depth, seen)
	local t = type(v)
	if t == "string" then return StripEscapes(v) end
	if t == "number" or t == "boolean" then return v end
	if t ~= "table" or (depth or 0) > 6 then return nil end
	seen = seen or {}
	if seen[v] then return nil end
	seen[v] = true
	local out, n = {}, 0
	for k, val in pairs(v) do
		local kt = type(k)
		if kt == "string" or kt == "number" then
			local pv = W.plain(val, (depth or 0) + 1, seen)
			if pv ~= nil then out[k] = pv; n = n + 1 end
		end
	end
	seen[v] = nil
	return out
end
-- A mutating op: runs fn, recalculates, and returns the op's result with the sidebar stats that
-- changed and the build's new XML (the server stores it as the next revision). fn may return a function
-- of the build, called after the recalculation, for results that only settle then.
function W.mutation(fn)
	return function(args)
		local before = W.sidebarValues(W.build())
		local result = fn(args, W.build())
		local b = main.modes.BUILD
		if main.mode == "BUILD" then b.buildFlag = true end
		W.pump()
		b = W.build()
		if type(result) == "function" then result = result(b) end -- results read after the recalculation
		local after = W.sidebarValues(b)
		local changed = {}
		for k, v in pairs(after) do
			if before[k] ~= v then changed[k] = { before = before[k] or json.null, after = v } end
		end
		for k, v in pairs(before) do
			if after[k] == nil then changed[k] = { before = v, after = json.null } end
		end
		if next(changed) == nil then changed = setmetatable({}, { __jsontype = "object" }) end
		if result == nil or (type(result) == "table" and next(result) == nil) then result = setmetatable({}, { __jsontype = "object" }) end
		return { result = result, changed = changed, xml = b:SaveDB("code") }
	end
end
-- Picks the entry of a dropdown the way a click does: sets the selection and runs its select function.
function W.choose(drop, match)
	for i, v in ipairs(drop.list) do
		if match(v) then
			drop.selIndex = i
			drop.selFunc(i, v)
			return v
		end
	end
end
-- Clicks the button labelled `label` on the top popup (confirm dialogs, rename dialogs).
function W.clickPopup(label)
	local p = main.popups[1]
	if not p then W.fail("worker_error", "expected a dialog, none is open") end
	for k, c in pairs(p.controls) do
		if type(c) == "table" and c.Click and (k == label or c.label == label) then
			c:Click()
			return true
		end
	end
	W.fail("worker_error", "dialog has no " .. label .. " button")
end
-- Loads another build (args.xml, from the store) into the Compare tab as the compared build for fn(tab, entry), then takes
-- it out again, so the compare list is as it was. args.otherSets {tree, skills, items, config} (1-based, in list order) picks
-- the compared build's sets with the Compare tab's set dropdowns first.
function W.compared(args, fn)
	local tab = W.build().compareTab
	local keep = { index = tab.activeCompareIndex, results = tab.comparePowerResults, n = #tab.compareEntries }
	if type(args.xml) ~= "string" or not tab:ImportBuild(args.xml, args.label or "Compared") then W.fail("invalid_input", "the other build could not be loaded for comparison") end
	local ok, out = pcall(function()
		local entry = tab.compareEntries[#tab.compareEntries]
		local sets = args.otherSets or {}
		for _, p in ipairs({ { "tree", "compareSpecSelect", entry.treeTab.specList }, { "skills", "compareSkillSetSelect", entry.skillsTab.skillSetOrderList },
			{ "items", "compareItemSetSelect", entry.itemsTab.itemSetOrderList }, { "config", "compareConfigSetSelect", entry.configTab.configSetOrderList } }) do
			local i = sets[p[1]]
			if i ~= nil then
				if not p[3][i] then W.fail("invalid_input", "the other build has no " .. p[1] .. " set " .. tostring(i) .. " (it has " .. #p[3] .. ")") end
				tab.controls[p[2]].selFunc(i)
			end
		end
		if entry.buildFlag then entry:Rebuild() end
		return fn(tab, entry)
	end)
	while #tab.compareEntries > keep.n do tab:RemoveBuild(#tab.compareEntries) end
	tab.activeCompareIndex, tab.comparePowerResults = keep.index, keep.results
	tab:UpdateBuildSelector()
	if not ok then error(out, 0) end
	return out
end
-- The timeless jewels (Legion and Abyss uniques: the ones whose text says "Conquered by"), as the unique list holds them, by
-- name: { name, base, raw, radius (label, none for the Abyss jewels), seedMin, seedMax (as written on the item; Elegant Hubris
-- 2000-160000), conquerors = [{ name, keystone?, variant? }] }. The seed line is the one with a "(min-max)" range; its
-- {variant:n} tags name the Variant line that gives the keystone ("Kaom (Strength of Blood)").
function W.timelessJewels()
	local out = {}
	for _, item in pairs(main.uniqueDB.list) do
		if item.raw:find("onquered by", 1, true) then
			local variants, jewel = {}, { name = item.title, base = item.baseName, raw = item.raw, conquerors = {},
				radius = item.jewelRadiusIndex and data.jewelRadius[item.jewelRadiusIndex].label or nil }
			for line in (item.raw .. "\n"):gmatch("(.-)\n") do
				local variant = line:match("^Variant: (.+)$")
				if variant then variants[#variants + 1] = variant end
				local tag, text = line:match("^{variant:([%d,]+)}(.*)$")
				local min, max = (text or line):match("%((%d+)%-(%d+)%)")
				if min then
					jewel.seedMin, jewel.seedMax = tonumber(min), tonumber(max)
					local first = tag and tonumber(tag:match("%d+"))
					local keystone = first and variants[first] and variants[first]:match("^%S+ %((.-)%)")
					jewel.conquerors[#jewel.conquerors + 1] = { name = (text or line):match("(%S+)$"), keystone = keystone, variant = first }
				end
			end
			out[#out + 1] = jewel
		end
	end
	table.sort(out, function(a, b) return a.name < b.name end)
	return out
end
-- Opens a list manager's rename/new dialog through its button, types the name, and saves it.
function W.listAction(list, button, index, title)
	if index then
		if not list.list[index] then W.fail("not_found", "no entry " .. tostring(index)) end
		list.selIndex, list.selValue = index, list.list[index]
	end
	local btn = list.controls[button]
	if not btn:IsEnabled() then W.fail("invalid_input", button .. " is not allowed here") end
	btn:Click()
	if button == "delete" then
		W.clickPopup("confirm")
	else
		local p = main.popups[1]
		p.controls.edit:SetText(title, true)
		if not p.controls.save:IsEnabled() then main:ClosePopup(); W.fail("invalid_input", "a name is required") end
		p.controls.save:Click()
	end
end
function W.takeCopied()
	local c = copied
	copied = nil
	return c
end

-- Warnings: launch.promptMsg (launch:ShowErrMsg) is an error; main.popups are notices.
local function drainPopups()
	local out = {}
	for _, popup in ipairs(main.popups) do
		local lines = { popup.title and StripEscapes(popup.title) or nil }
		for _, c in ipairs(popup.controls or {}) do
			if type(c.label) == "string" and c.label ~= "" then lines[#lines + 1] = StripEscapes(c.label) end
		end
		out[#out + 1] = table.concat(lines, ": ")
	end
	wipeTable(main.popups)
	return out
end
local function takePrompt()
	local msg = launch.promptMsg
	launch.promptMsg = nil
	launch.promptFunc = nil
	if msg then
		msg = StripEscapes(msg):gsub("^Error:%s*", ""):gsub("\n.*Press Enter/Escape.*$", "")
	end
	return msg
end

local ops = {}
for _, domain in ipairs({ "builds", "stats", "lookup", "tree", "config", "skills", "items", "evaluate", "party", "ui", "loadouts" }) do
	for name, fn in pairs(dofile(here .. "/ops/" .. domain .. ".lua")(W)) do
		ops[domain .. "." .. name] = fn
	end
end
ops["worker.ping"] = function()
	return { pobVersion = launch.versionNumber, latestTreeVersion = latestTreeVersion, heapKB = collectgarbage("count") }
end
-- What reached a way out since the last call (see the stubs above), then counted from zero again.
ops["worker.reach"] = function()
	local r = { subScripts = reach.subScripts, urls = reach.urls, writes = setmetatable(reach.writes, { __jsontype = "array" }) }
	reach = { subScripts = 0, urls = 0, writes = {} }
	return r
end
ops["worker.gc"] = function()
	collectgarbage("collect")
	collectgarbage("collect")
	return { heapKB = collectgarbage("count") }
end

send({ ready = true, bootMs = nowMs() - t0, pobVersion = launch.versionNumber, latestTreeVersion = latestTreeVersion })

for line in io.lines() do
	local req = json.decode(line)
	local id = type(req) == "table" and req.id or nil
	if type(req) ~= "table" or type(req.op) ~= "string" then
		send({ id = id, ok = false, error = { code = "invalid_input", message = "request must be {id, op, args}" } })
	elseif not ops[req.op] then
		send({ id = id, ok = false, error = { code = "unsupported", message = "unknown op " .. req.op } })
	else
		local started = nowMs()
		local ok, res = xpcall(ops[req.op], function(e)
			if type(e) == "table" then return e end
			-- the Lua text names server files: it goes to the server log, the caller gets the op only
			return { code = "worker_error", message = "the engine failed while running " .. req.op, detail = tostring(e), trace = debug.traceback("", 2) }
		end, type(req.args) == "table" and req.args or {})
		local prompt = takePrompt()
		local warnings = drainPopups()
		if ok and prompt then
			ok, res = false, { code = "worker_error", message = prompt }
		elseif not ok and prompt then
			warnings[#warnings + 1] = prompt
		end
		if not ok and res.trace then
			stderr:write(res.detail, res.trace, "\n")
			res.trace = nil
		end
		if ok then
			send({ id = id, ok = true, result = res, warnings = warnings, ms = nowMs() - started })
		else
			send({ id = id, ok = false, error = res, warnings = warnings, ms = nowMs() - started })
		end
	end
end
