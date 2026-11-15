-- The Lua half of "the page writes back only the build it loaded" (patches/pob-web-load-build.patch), run by
-- build-web.sh step 2c against real Path of Building: it puts the worker boot (api/lua/worker.lua) and the patched
-- boot.lua functions in front of this file. SENTINEL is the string the patch returns; FIXTURE a build XML.
-- Prints one line per check; exits 1 if any says FAIL.
local SENTINEL = assert(os.getenv("SENTINEL"))
local build = main.modes["BUILD"]
local importTab
local function frame() runCallback("OnFrame") end
local out = {}
local function check(label, cond, extra)
	out[#out + 1] = (cond and "ok    " or "FAIL  ") .. label .. (extra ~= nil and ("  [" .. tostring(extra) .. "]") or "")
end
local function read()
	local ok, v = pcall(getBuildCode)
	if not ok then return "ERROR: " .. tostring(v) end
	return (v)
end
local function decode(code) return Inflate(common.base64.decode(code:gsub("-", "+"):gsub("_", "/"))) or "" end
local function class(code) if code == SENTINEL or code:match("^ERROR") then return code:sub(1, 60) end return decode(code):match('className="([%w ]+)"') end
local function level(code) return decode(code):match('<Build[^>]-level="(%d+)"') end
local f = assert(io.open(os.getenv("FIXTURE"))); local xml = f:read("*a"); f:close()
local code = common.base64.encode(Deflate(xml)):gsub("+", "-"):gsub("/", "_")
local isCode = function(c) return c ~= SENTINEL and not c:match("^ERROR") end

check("00 boot mode", true, main.mode)
check("01 before any page load: sentinel", read() == SENTINEL, read():sub(1, 50))
loadBuildFromCode("My build\n" .. code)
importTab = build.importTab
local c = read()
check("02 after the page's load: a build code", isCode(c), class(c))
check("03 name set from the page", build.buildName == "My build", build.buildName)
build.characterLevel = 42; build.characterLevelAutoMode = false; build.modFlag = true; build.buildFlag = true; frame()
c = read()
check("04 an edit in place still reads as this build", isCode(c) and level(c) == "42", level(c))
-- Back ("Don't Save" ends in CloseBuild)
build:CloseBuild()
c = read()
check("05 Back pressed, frame not yet run: still the loaded build", isCode(c) and class(c) == "Witch", class(c))
frame()
check("06 Back, after the frame: mode LIST, sentinel", main.mode == "LIST" and read() == SENTINEL, main.mode .. " " .. read():sub(1, 40))
-- New
main:SetMode("BUILD", false, "Unnamed build"); frame()
c = read()
local raw = build:SaveDB("code")
check("07 New: sentinel (the view holds " .. tostring(raw and raw:match('className="([%w ]+)"')) .. " level " .. tostring(raw and raw:match('<Build[^>]-level="(%d+)"')) .. ")", main.mode == "BUILD" and c == SENTINEL, class(c))
-- Try again
loadBuildFromCode("My build\n" .. code)
c = read()
check("08 the page loads again: the stored build", isCode(c) and class(c) == "Witch" and level(c) ~= "42", tostring(class(c)) .. " level " .. tostring(level(c)))
-- Back and New inside one frame
build:CloseBuild(); main:SetMode("BUILD", false, "Unnamed build"); frame()
c = read()
check("09 Back and New in one frame: sentinel", main.mode == "BUILD" and c == SENTINEL, class(c))
loadBuildFromCode("My build\n" .. code)
-- the view's own import box (mode forced to 'new build' while the build has no file)
importTab.controls.importCodeIn:SetText(code, true)
check("10 import box mode for a build with no local file", importTab.controls.importCodeMode.selIndex == 2, importTab.controls.importCodeMode.selIndex)
importTab.controls.importCodeGo.onClick(); frame()
c = read()
check("11 import as a new build in the view: sentinel", c == SENTINEL and build.buildName == "Imported build", class(c) .. " / " .. tostring(build.buildName))
loadBuildFromCode("My build\n" .. code)
-- a locally saved build opened from the list
os.execute('mkdir -p "' .. main.buildPath .. '"')
local sf = assert(io.open(main.buildPath .. "Saved.xml", "w")); sf:write(xml); sf:close()
build:CloseBuild(); frame()
main:SetMode("BUILD", main.buildPath .. "Saved.xml", "Saved"); frame()
c = read()
check("12 a saved build opened from the list: sentinel", main.mode == "BUILD" and build.buildName == "Saved" and c == SENTINEL, class(c) .. " / " .. tostring(build.buildName))
loadBuildFromCode("My build\n" .. code)
-- loads the view refuses
local ok1, e1 = pcall(loadBuildFromCode, "My build\nnot-a-code!!")
c = read()
check("13 unreadable code: load raises, the earlier loaded build still reads", not ok1 and isCode(c) and class(c) == "Witch", tostring(e1):sub(-45))
local ok2, e2 = pcall(loadBuildFromCode, "My build\nhttps://pobb.in/abcdefgh")
c = read()
check("14 share link: load raises, nothing fetched, the earlier build still reads", not ok2 and isCode(c) and not importTab.importCodeFetching, tostring(e2):sub(-45))
local bad = common.base64.encode(Deflate("<NotABuild/>")):gsub("+", "-"):gsub("/", "_")
local ok3, e3 = pcall(loadBuildFromCode, "My build\n" .. bad)
c = read()
check("15 decodable text that is no build: after the load the read is the sentinel", c == SENTINEL, "load ok=" .. tostring(ok3) .. " mode=" .. tostring(main.mode) .. " " .. tostring(e3 or ""):sub(-60))
main:ClosePopup(); main:SetMode("BUILD", false, "Unnamed build"); frame()
check("16 New after that: sentinel", read() == SENTINEL, read():sub(1, 40))
loadBuildFromCode("My build\n" .. code)
-- saved locally with Path of Building's own Save, then "Import to this build"
build.dbFileName = main.buildPath .. "Local.xml"; build.buildName = "Local"
local okS, eS = pcall(function() build:SaveDBFile() end)
c = read()
check("17 after Path of Building's own Save: still this build", isCode(c) and class(c) == "Witch", "save ok=" .. tostring(okS) .. " " .. tostring(eS or ""))
importTab.controls.importCodeIn:SetText(code, true)
check("18 import box mode once the build has a local file", true, importTab.controls.importCodeMode.selIndex)
build:Shutdown(); build:Init(build.dbFileName, build.buildName, xml, false); frame()
c = read()
check("19 'Import to this build' (same build, re-initialised): sentinel", c == SENTINEL, class(c))
io.stdout:write(table.concat(out, "\n"), "\n")
local failed = 0; for _, l in ipairs(out) do if l:sub(1, 4) == "FAIL" then failed = failed + 1 end end
os.exit(failed == 0 and 0 or 1)
