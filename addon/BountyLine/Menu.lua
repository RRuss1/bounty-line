-- Right-click unit menus (spec 5.4b) through the modern Menu API.
--
-- Which tags Forever uses for enemy players isn't verified yet (spec Section 23, item 5), so
-- we hook every unit-menu tag we know. The section only appears when the menu has a unit
-- that passes the opposite-faction gate, so hooking extra tags is harmless.
-- /bl debugmenu prints each tag as menus open.
local _, ns = ...
local L = ns.L

local TAGS = {
  "MENU_UNIT_ENEMY_PLAYER", "MENU_UNIT_TARGET", "MENU_UNIT_FOCUS", "MENU_UNIT_PLAYER",
  "MENU_UNIT_PARTY", "MENU_UNIT_RAID", "MENU_UNIT_RAID_PLAYER", "MENU_UNIT_ARENAENEMY",
  "MENU_UNIT_SELF", "MENU_UNIT_FRIEND", "MENU_UNIT_GUILD", "MENU_UNIT_COMMUNITIES_GUILD_MEMBER",
  "MENU_UNIT_WORLD_STATE_SCORE", "MENU_UNIT_PVP_SCOREBOARD",
}

local function addSection(tag, rootDescription, contextData)
  local unit = contextData and contextData.unit
  if BountyLineDB.settings.debugMenu then
    ns.Print(L.DEBUGMENU_TAG:format(tag, tostring(unit)))
  end
  if not unit then return end -- chat-name menus carry no unit (spec 5.4b: not supported)

  local snap, why = ns.SnapshotUnit(unit)
  if not snap and why ~= "SECRET" then return end

  rootDescription:CreateDivider()
  rootDescription:CreateTitle(L.ADDON)
  local existing = snap and ns.GetBounty(snap.guid)
  if existing then
    rootDescription:CreateButton(L.MENU_VIEW:format(existing.id, ns.FormatGold(existing.reward)), function()
      ns.OpenBoard(existing.id) -- opens the board with this bounty highlighted
    end)
    rootDescription:CreateButton(L.MENU_ADD, function() ns.OpenAmountEntry(snap, nil, nil, existing.id) end)
  end
  local button = rootDescription:CreateButton(L.MENU_SET_BOUNTY, function()
    if snap then ns.OpenAmountEntry(snap) end
  end)
  if not snap then
    -- Unit data is hidden mid-combat: show the item, disabled, with the reason.
    button:SetEnabled(false)
    button:SetTooltip(function(tooltip) GameTooltip_SetTitle(tooltip, L.SECRET) end)
  end
end

function ns.SetupMenus()
  if not (Menu and Menu.ModifyMenu) then return end
  for _, tag in ipairs(TAGS) do
    Menu.ModifyMenu(tag, function(_, rootDescription, contextData) addSection(tag, rootDescription, contextData) end)
  end
end
