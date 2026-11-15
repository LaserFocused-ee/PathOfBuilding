-- tree.* ops: class and ascendancy, node allocation, masteries, tattoos, tree links, tree specs.
-- Mutations go through the same functions and control callbacks the Tree tab and the top bar use.
return function(W)
	local main = W.main
	local ops = {}

	local function nodeRef(spec, ref)
		if type(ref) == "string" and ref:match("^%d+$") then ref = tonumber(ref) end -- ids from a query string
		if type(ref) == "number" then
			local node = spec.nodes[ref]
			if not node then W.fail("not_found", "no passive node " .. ref) end
			return node
		end
		if type(ref) ~= "string" or ref == "" then W.fail("invalid_input", "a node is an id or an exact name") end
		local found
		for _, node in pairs(spec.nodes) do
			if node.dn == ref and node.type ~= "Mastery" then
				if found then W.fail("invalid_input", "more than one node is named " .. ref .. "; use its id") end
				found = node
			end
		end
		if not found then W.fail("not_found", "no passive node named " .. ref) end
		return found
	end

	local function brief(spec, node)
		return { id = node.id, name = node.dn, type = node.type, ascendancy = node.ascendancyName, allocated = spec.allocNodes[node.id] ~= nil }
	end

	local function specSummary(tab, i, spec)
		local used, asc = spec:CountAllocNodes()
		return { index = i, title = spec.title or "Default", treeVersion = spec.treeVersion, className = spec.curClassName,
			ascendancy = spec.curAscendClassName ~= "None" and spec.curAscendClassName or nil, points = used, ascendancyPoints = asc, active = i == tab.activeSpec }
	end

	-- The tree as allocated: class, ascendancies, nodes, masteries, tattoos, jewel sockets, specs.
	function ops.get()
		local b = W.build()
		local spec, tab = b.spec, b.treeTab
		local nodes = {}
		for id, node in pairs(spec.allocNodes) do
			if node.type ~= "ClassStart" and node.type ~= "AscendClassStart" then nodes[#nodes + 1] = brief(spec, node) end
		end
		table.sort(nodes, function(a, c) return a.id < c.id end)
		local masteries = {}
		for nodeId, effectId in pairs(spec.masterySelections) do
			local effect = spec.tree.masteryEffects[effectId]
			masteries[#masteries + 1] = { nodeId = nodeId, effectId = effectId, stats = effect and W.plain(effect.sd) or {} }
		end
		local tattoos = {}
		for nodeId, node in pairs(spec.hashOverrides) do
			tattoos[#tattoos + 1] = { nodeId = nodeId, name = node.dn, stats = W.plain(node.sd) }
		end
		local jewels = {}
		for nodeId, itemId in pairs(spec.jewels) do
			if itemId and itemId > 0 then jewels[#jewels + 1] = { nodeId = nodeId, itemId = itemId } end
		end
		local specs = {}
		for i, s in ipairs(tab.specList) do specs[#specs + 1] = specSummary(tab, i, s) end
		local used, asc, secondary = spec:CountAllocNodes()
		return {
			treeVersion = spec.treeVersion, className = spec.curClassName,
			ascendancy = spec.curAscendClassName ~= "None" and spec.curAscendClassName or nil,
			bloodline = spec.curSecondaryAscendClassName ~= "None" and spec.curSecondaryAscendClassName or nil,
			points = used, ascendancyPoints = asc, bloodlinePoints = secondary,
			nodes = nodes, masteries = masteries, tattoos = tattoos, jewelSockets = jewels, specs = specs,
		}
	end

	-- args: className, onDisconnected? ("fail" | "reset" | "connect"). The class dropdown's handler (Build.lua:259).
	ops.set_class = W.mutation(function(args, b)
		local classId = b.spec.tree.classNameMap[args.className]
		if not classId then W.fail("invalid_input", "unknown class " .. tostring(args.className)) end
		if classId == b.spec.curClassId then return { className = b.spec.curClassName } end
		b.controls.classDrop.selFunc(nil, { classId = classId, label = args.className })
		if main.popups[1] then
			local how = args.onDisconnected or "fail"
			if how == "reset" then W.clickPopup("confirm")
			elseif how == "connect" then W.clickPopup("Connect Path")
			else
				main:ClosePopup()
				W.fail("invalid_input", "the tree is not connected to " .. args.className .. "'s start; pass onDisconnected reset or connect")
			end
		end
		if b.spec.curClassId ~= classId then W.fail("invalid_input", "could not connect the tree to " .. args.className) end
		return { className = b.spec.curClassName }
	end)

	-- args: ascendancy (name, or "None"). The ascendancy dropdown's handler.
	ops.set_ascendancy = W.mutation(function(args, b)
		local id = 0
		if args.ascendancy ~= "None" then
			local asc = b.spec.tree.ascendNameMap[args.ascendancy]
			if not asc or asc.ascendClassId == 0 or asc.class.name ~= b.spec.curClassName then
				W.fail("invalid_input", tostring(args.ascendancy) .. " is not an ascendancy of " .. b.spec.curClassName)
			end
			id = asc.ascendClassId
		end
		b.controls.ascendDrop.selFunc(nil, { ascendClassId = id })
		return { ascendancy = b.spec.curAscendClassName }
	end)

	-- args: bloodline (id such as Oshabi, full name, or "None"). The secondary ascendancy dropdown's handler.
	ops.set_bloodline = W.mutation(function(args, b)
		local id = 0
		if args.bloodline ~= "None" then
			local map = b.spec.tree.secondaryAscendNameMap or {}
			local entry
			for key, v in pairs(map) do
				if key == args.bloodline or (v.ascendClass and v.ascendClass.name == args.bloodline) then entry = v end
			end
			if not entry then W.fail("invalid_input", "unknown bloodline " .. tostring(args.bloodline) .. " on tree " .. b.spec.treeVersion) end
			id = entry.ascendClassId
		end
		b.controls.secondaryAscendDrop.selFunc(nil, { ascendClassId = id })
		return { bloodline = b.spec.curSecondaryAscendClassName }
	end)

	-- args: nodes (ids or names). Allocates each with the path to it, as a click on the node does.
	ops.allocate = W.mutation(function(args, b)
		local spec = b.spec
		if type(args.nodes) ~= "table" or #args.nodes == 0 then W.fail("invalid_input", "nodes is required") end
		local done = {}
		for _, ref in ipairs(args.nodes) do
			local node = nodeRef(spec, ref)
			if not node.alloc then
				if not node.path then W.fail("invalid_input", (node.dn or node.id) .. " cannot be reached from the tree (other class or ascendancy?)") end
				spec:AllocNode(node)
			end
			done[#done + 1] = node.id
		end
		spec:AddUndoState()
		return { allocated = done }
	end)

	-- args: nodes. Deallocates each and everything that depended on it.
	ops.deallocate = W.mutation(function(args, b)
		local spec = b.spec
		if type(args.nodes) ~= "table" or #args.nodes == 0 then W.fail("invalid_input", "nodes is required") end
		for _, ref in ipairs(args.nodes) do
			local node = nodeRef(spec, ref)
			if node.alloc then spec:DeallocNode(node) end
		end
		spec:AddUndoState()
		return {}
	end)

	-- The Reset Tree button (TreeTab.lua:136).
	ops.reset = W.mutation(function(_, b)
		b.spec:ResetNodes()
		b.spec:BuildAllDependsAndPaths()
		b.spec:AddUndoState()
		return {}
	end)

	-- args: nodeId. The effects a mastery offers.
	function ops.mastery_options(args)
		local spec = W.build().spec
		local node = nodeRef(spec, args.nodeId)
		if node.type ~= "Mastery" then W.fail("invalid_input", "node " .. node.id .. " is not a mastery") end
		local out = {}
		for _, e in ipairs(node.masteryEffects or {}) do
			local effect = spec.tree.masteryEffects[e.effect]
			out[#out + 1] = { effectId = e.effect, stats = W.plain(effect.sd), selected = spec.masterySelections[node.id] == e.effect }
		end
		return { nodeId = node.id, name = node.dn, allocated = node.alloc == true, effects = out }
	end

	-- args: nodeId, effectId. The mastery popup's save (TreeTab.lua:1000), which also allocates the node.
	ops.set_mastery = W.mutation(function(args, b)
		local spec, tab = b.spec, b.treeTab
		local node = nodeRef(spec, args.nodeId)
		if node.type ~= "Mastery" then W.fail("invalid_input", "node " .. node.id .. " is not a mastery") end
		local offered = false
		for _, e in ipairs(node.masteryEffects or {}) do offered = offered or e.effect == args.effectId end
		if not offered then W.fail("invalid_input", "mastery " .. node.id .. " has no effect " .. tostring(args.effectId)) end
		for otherNode, effectId in pairs(spec.masterySelections) do
			if effectId == args.effectId and otherNode ~= node.id then W.fail("invalid_input", "effect " .. args.effectId .. " is already taken on node " .. otherNode) end
		end
		if not node.alloc and not node.path then W.fail("invalid_input", "mastery " .. node.id .. " cannot be reached from the tree") end
		tab:SaveMasteryPopup(node, { selValue = { id = args.effectId } })
		return { nodeId = node.id, effectId = spec.masterySelections[node.id] }
	end)

	-- The Replace Modifier of Node dialog (TreeTab.lua:846), opened on the nodes a right-click opens it on
	-- (PassiveTreeView.lua:530-541): a tattooed node, a small attribute, a +30 attribute notable, a keystone, an unallocated
	-- mastery; never a cluster jewel's passive. `legacy` ticks Show Legacy Tattoos; the dialog's own list is the answer.
	local function tattooDialog(b, ref, legacy)
		local node = nodeRef(b.spec, ref)
		local sd1 = node.sd and node.sd[1] or ""
		local open = not node.expansionSkill and (node.isTattoo or (node.type == "Normal" and (node.dn == "Strength" or node.dn == "Dexterity" or node.dn == "Intelligence"))
			or (node.type == "Notable" and (sd1:match("+30 to Dexterity") or sd1:match("+30 to Strength") or sd1:match("+30 to Intelligence")))
			or node.type == "Keystone" or (node.type == "Mastery" and not node.alloc and node.masteryEffects))
		if not open then W.fail("invalid_input", ("node %d (%s) takes no tattoo: small attributes, +30 attribute notables, keystones and unallocated masteries do"):format(node.id, node.dn)) end
		b.treeTab:ModifyNodePopup(node)
		local c = main.popups[1].controls
		if legacy ~= nil and c.showLegacyTattoo.state ~= legacy then
			c.showLegacyTattoo.state = legacy
			c.showLegacyTattoo.changeFunc(legacy)
		end
		return node, c
	end
	local function tattooCount(spec)
		local n = 0
		for _, t in pairs(spec.hashOverrides) do
			if t.isTattoo and not t.dn:find("Runegraft") then n = n + 1 end
		end
		return n
	end

	-- args: node, legacy?. The tattoos the node can take, as the dialog's Modifier list shows them.
	function ops.tattoo_options(args)
		local b = W.build()
		local tab, prevLegacy, popups = b.treeTab, b.treeTab.showLegacyTattoo, #main.popups
		local ok, out = pcall(function()
			local node, c = tattooDialog(b, args.node, args.legacy)
			local list = {}
			for _, g in ipairs(c.modSelect.list) do
				local t = b.spec.tree.tattoo.nodes[g.id]
				list[#list + 1] = { id = g.id, name = t.dn, stats = setmetatable(copyTable(g.descriptions), { __jsontype = "array" }), legacy = t.legacy == true }
			end
			local current = b.spec.hashOverrides[node.id]
			return { node = brief(b.spec, node), current = current and current.dn or W.json.null, tattoos = tattooCount(b.spec), limit = 50,
				options = setmetatable(list, { __jsontype = "array" }) }
		end)
		while #main.popups > popups do main:ClosePopup() end
		tab.showLegacyTattoo = prevLegacy
		if not ok then error(out, 0) end
		return out
	end

	-- args: node, tattoo (its name or id, exact or one unique part), legacy?. The dialog's Add button.
	ops.tattoo = W.mutation(function(args, b)
		local popups = #main.popups
		local ok, out = pcall(function()
			local node, c = tattooDialog(b, args.node, args.legacy)
			local want = type(args.tattoo) == "string" and args.tattoo:lower() or W.fail("invalid_input", "tattoo is a tattoo name or id")
			local hits, exact = {}, nil
			for i, g in ipairs(c.modSelect.list) do
				local name = b.spec.tree.tattoo.nodes[g.id].dn
				if g.id:lower() == want or name:lower() == want then exact = i end
				if name:lower():find(want, 1, true) or g.id:lower():find(want, 1, true) then hits[#hits + 1] = i end
			end
			local pick = exact or (#hits == 1 and hits[1])
			if not pick then
				local names = {}
				for _, i in ipairs(#hits > 1 and hits or {}) do names[#names + 1] = b.spec.tree.tattoo.nodes[c.modSelect.list[i].id].dn end
				W.fail("invalid_input", #hits > 1 and ("tattoo %q matches %d: %s"):format(args.tattoo, #hits, table.concat(names, "; "))
					or ("%s cannot go on %s (tree.tattoo_options lists what can)"):format(args.tattoo, node.dn))
			end
			c.modSelect.selIndex = pick
			c.modSelect.selFunc(pick, c.modSelect.list[pick])
			c.save:Click()
			return node.id
		end)
		while #main.popups > popups do main:ClosePopup() end
		if not ok then error(out, 0) end
		return function(nb)
			local t = nb.spec.hashOverrides[out]
			return { nodeId = out, tattoo = t and t.dn or W.json.null, tattoos = tattooCount(nb.spec), limit = 50 }
		end
	end)

	-- args: node. The dialog's Reset Node button: the node's own passive back.
	ops.untattoo = W.mutation(function(args, b)
		local node = nodeRef(b.spec, args.node)
		if not b.spec.hashOverrides[node.id] then W.fail("invalid_input", ("node %d (%s) has no tattoo"):format(node.id, node.dn)) end
		local popups = #main.popups
		local ok, err = pcall(function()
			local _, c = tattooDialog(b, node.id)
			c.reset:Click()
		end)
		while #main.popups > popups do main:ClosePopup() end
		if not ok then error(err, 0) end
		return function(nb) return { nodeId = node.id, name = nb.spec.nodes[node.id].dn, tattoos = tattooCount(nb.spec), limit = 50 } end
	end)

	-- The Remove All Tattoos button (TreeTab.lua:143).
	ops.remove_tattoos = W.mutation(function(_, b)
		local tab = b.treeTab
		local n = 0
		for id, node in pairs(b.spec.hashOverrides) do
			if node.isTattoo then
				tab:RemoveTattooFromNode(b.spec.nodes[id])
				n = n + 1
			end
		end
		tab.modFlag = true
		return { removed = n }
	end)

	-- The export popup's link (TreeTab.lua:818).
	function ops.export_url()
		local spec = W.build().spec
		return { url = spec:EncodeURL(treeVersions[spec.treeVersion].url) }
	end

	-- args: url, title. The tree import popup (TreeTab.lua:687): a new spec, made active.
	ops.import_url = W.mutation(function(args, b)
		if type(args.url) ~= "string" or not args.url:match("%S") then W.fail("invalid_input", "url is required") end
		local before = #b.treeTab.specList
		b.treeTab:OpenImportPopup()
		local p = main.popups[1]
		p.controls.name:SetText(args.title or "Imported tree", true)
		p.controls.edit:SetText(args.url, true)
		p.controls.import:Click()
		if main.popups[1] == p then
			local msg = W.strip(p.controls.msg.label or "")
			main:ClosePopup()
			W.fail("invalid_input", msg ~= "" and msg or "the tree link could not be imported here (links that need a network lookup are not supported)")
		end
		if #b.treeTab.specList ~= before + 1 then W.fail("worker_error", "tree import made no new tree") end
		return specSummary(b.treeTab, b.treeTab.activeSpec, b.spec)
	end)

	-- Runs one of the tree list manager's buttons (PassiveSpecListControl.lua), then closes the manager.
	local function manage(b, button, index, title)
		b.treeTab:OpenSpecManagePopup()
		local manager = main.popups[1]
		local ok, err = pcall(W.listAction, manager.controls[1], button, index, title)
		while main.popups[1] and main.popups[1] ~= manager do main:ClosePopup() end
		main:ClosePopup()
		if not ok then error(err, 0) end
	end

	-- args: title. The New button: an empty tree of the current class on the latest version.
	ops.spec_new = W.mutation(function(args, b)
		manage(b, "new", nil, args.title or "New tree")
		return { count = #b.treeTab.specList }
	end)
	-- args: index, title?
	ops.spec_copy = W.mutation(function(args, b)
		manage(b, "copy", args.index, args.title or ((b.treeTab.specList[args.index] or {}).title or "Default") .. " copy")
		return { count = #b.treeTab.specList }
	end)
	-- args: index, title
	ops.spec_rename = W.mutation(function(args, b)
		manage(b, "rename", args.index, args.title)
		return {}
	end)
	-- args: index
	ops.spec_delete = W.mutation(function(args, b)
		manage(b, "delete", args.index)
		return { count = #b.treeTab.specList }
	end)
	-- args: index. The tree dropdown's handler (TreeTab.lua:42).
	ops.spec_activate = W.mutation(function(args, b)
		if not b.treeTab.specList[args.index] then W.fail("not_found", "no tree " .. tostring(args.index)) end
		b.treeTab.controls.specSelect.selFunc(args.index, b.treeTab.specList[args.index])
		return { active = b.treeTab.activeSpec }
	end)

	-- args: index, to. A drag in the tree list manager (ListControl.lua:441); OnOrderChange keeps the active tree on its spec.
	ops.spec_move = W.mutation(function(args, b)
		local tab = b.treeTab
		for _, x in ipairs({ args.index, args.to }) do
			if type(x) ~= "number" or not tab.specList[x] then W.fail("not_found", "no tree position " .. tostring(x)) end
		end
		if args.to ~= args.index then
			local popups = #main.popups
			local ok, err = pcall(function()
				tab:OpenSpecManagePopup()
				local list
				for _, c in ipairs(main.popups[1].controls) do
					if c.OnOrderChange then list = c break end
				end
				if not list then W.fail("worker_error", "the tree list manager has no list") end
				local spec = table.remove(list.list, args.index)
				table.insert(list.list, args.to, spec)
				list:OnOrderChange(args.index, args.to)
			end)
			while #main.popups > popups do main:ClosePopup() end
			if not ok then error(err, 0) end
		end
		return { index = args.to, active = tab.activeSpec }
	end)

	-- args: version? (default latest), keepOld? The convert popup's Convert / Copy + Convert (TreeTab.lua:654).
	ops.convert = W.mutation(function(args, b)
		local version = args.version or latestTreeVersion
		if not treeVersions[version] then W.fail("invalid_input", "unknown tree version " .. tostring(version)) end
		if b.spec.treeVersion == version then W.fail("invalid_input", "the tree is already on " .. version) end
		b.treeTab:OpenVersionConvertPopup(version)
		W.clickPopup(args.keepOld and "convertCopy" or "convert")
		return { treeVersion = b.spec.treeVersion }
	end)

	-- args: version? (default latest). The Convert all dialog (TreeTab.lua:673): every tree not on that version, replaced.
	ops.convert_all = W.mutation(function(args, b)
		local version = args.version or latestTreeVersion
		if not treeVersions[version] then W.fail("invalid_input", "unknown tree version " .. tostring(version)) end
		local tab, popups, converted = b.treeTab, #main.popups, 0
		for _, s in ipairs(tab.specList) do
			if s.treeVersion ~= version then converted = converted + 1 end
		end
		local ok, err = pcall(function()
			tab:OpenVersionConvertAllPopup(version)
			W.clickPopup("convert")
		end)
		while #main.popups > popups do main:ClosePopup() end
		if not ok then error(err, 0) end
		local specs = {}
		for i, s in ipairs(tab.specList) do specs[#specs + 1] = specSummary(tab, i, s) end
		return { converted = converted, specs = specs }
	end)

	-- args: to, from? Shortest path. Without `from`, the path the tree would allocate to reach `to`;
	-- with it, the fewest-node route between two nodes over tree links (no such tool in the application).
	-- args: socket (node id or "Jewel <id>"), radius? (1-based index or label of data.jewelRadius; default the named radii, not
	-- the Variable rings). The passives within each radius of a jewel socket, as the tree precalculates them for radius jewels
	-- (PassiveTree.lua: socket.nodesInRadius), with the inner and outer distance and what is allocated.
	function ops.radius_nodes(args)
		local spec = W.build().spec
		local ref = type(args.socket) == "string" and args.socket:match("^Jewel (%d+)$") or args.socket
		local socket = nodeRef(spec, ref)
		if socket.type ~= "Socket" or not socket.nodesInRadius then W.fail("invalid_input", "node " .. socket.id .. " is not a jewel socket with a radius") end
		local radii = {}
		local want = tonumber(args.radius) or args.radius -- a query string sends the index as text
		for i, r in ipairs(data.jewelRadius) do
			local pick = want == nil and r.label ~= "Variable" or want == i or want == r.label
			if pick then
				local nodes, allocated = {}, 0
				for id, node in pairs(socket.nodesInRadius[i] or {}) do
					local live = spec.nodes[id] or node
					nodes[#nodes + 1] = brief(spec, live)
					if spec.allocNodes[id] then allocated = allocated + 1 end
				end
				table.sort(nodes, function(a, c) return a.id < c.id end)
				radii[#radii + 1] = { index = i, label = r.label, inner = r.inner, outer = r.outer, total = #nodes, allocated = allocated, nodes = setmetatable(nodes, { __jsontype = "array" }) }
			end
		end
		if #radii == 0 then W.fail("invalid_input", "no radius " .. tostring(args.radius) .. "; radii are 1 to " .. #data.jewelRadius .. " (Small, Medium, Large, Very Large, Massive, then Variable rings)") end
		return { socket = socket.id, allocated = spec.allocNodes[socket.id] ~= nil, radii = radii }
	end

	function ops.path(args)
		local spec = W.build().spec
		local target = nodeRef(spec, args.to)
		local list = {}
		if args.from == nil then
			if target.alloc then return { length = 0, nodes = {} } end
			if not target.path then W.fail("invalid_input", "node " .. target.id .. " cannot be reached from the tree") end
			for i = #target.path, 1, -1 do list[#list + 1] = brief(spec, target.path[i]) end
			return { length = #list, nodes = list }
		end
		local start = nodeRef(spec, args.from)
		local prev, queue, head = { [start] = start }, { start }, 1
		while queue[head] and not prev[target] do
			local node = queue[head]
			head = head + 1
			for _, nb in ipairs(node.linked) do
				if not prev[nb] and nb.type ~= "Mastery" and nb.ascendancyName == start.ascendancyName and (nb.type ~= "ClassStart" or nb == target) then
					prev[nb] = node
					queue[#queue + 1] = nb
				end
			end
		end
		if not prev[target] then W.fail("not_found", "no route from " .. start.id .. " to " .. target.id) end
		local node = target
		while node ~= start do
			table.insert(list, 1, brief(spec, node))
			node = prev[node]
		end
		return { length = #list, nodes = list }
	end

	return ops
end
