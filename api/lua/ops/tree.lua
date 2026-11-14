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

	-- args: version? (default latest), keepOld? The convert popup's Convert / Copy + Convert (TreeTab.lua:654).
	ops.convert = W.mutation(function(args, b)
		local version = args.version or latestTreeVersion
		if not treeVersions[version] then W.fail("invalid_input", "unknown tree version " .. tostring(version)) end
		if b.spec.treeVersion == version then W.fail("invalid_input", "the tree is already on " .. version) end
		b.treeTab:OpenVersionConvertPopup(version)
		W.clickPopup(args.keepOld and "convertCopy" or "convert")
		return { treeVersion = b.spec.treeVersion }
	end)

	-- args: to, from? Shortest path. Without `from`, the path the tree would allocate to reach `to`;
	-- with it, the fewest-node route between two nodes over tree links (no such tool in the application).
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
