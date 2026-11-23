-- The in-game Bounty Board (/bl, left-click the minimap button). Three tabs:
--   Wanted       two tables: Open Seasons (bounties on a whole guild) on top, then open
--                bounties (pack + pending): reward, poster, last sighting, expiry
--   My Bounties  the ones you posted
--   My Kills     your saved kill codes; click one to open its code again
-- Click a column header to sort. Hover a row for details; right-click a wanted row to add gold.
local _, ns = ...
local L = ns.L

local ROW_H = 26
local COLS = { { 8, 34 }, { 46, 170 }, { 220, 80 }, { 304, 120 }, { 428, 150 }, { 582, 70 } } -- x, width
local BOUNTY_HEADS = { "#", L.COL_TARGET, L.COL_REWARD, L.COL_POSTER, L.COL_SEEN, L.COL_EXPIRES }
local KILL_HEADS = { "#", L.COL_TARGET, L.COL_REWARD, "", L.COL_KILLED, L.COL_SHOT }
local SORT_KEYS = { "id", "name", "reward", "poster", false, "expires" }
local FACTION_NAME = { "Alliance", "Horde" }
local TABS = { { "wanted", L.TAB_WANTED }, { "mine", L.TAB_MINE }, { "kills", L.TAB_KILLS } }
local frame

function ns.Ago(t)
  local s = math.max(0, GetServerTime() - t)
  if s < 90 then return L.AGO_NOW end
  if s < 3600 then return L.AGO_MIN:format(math.floor(s / 60)) end
  if s < 172800 then return L.AGO_HOUR:format(math.floor(s / 3600)) end
  return L.AGO_DAY:format(math.floor(s / 86400))
end

local function zoneName(mapID)
  local info = mapID and mapID > 0 and C_Map.GetMapInfo and C_Map.GetMapInfo(mapID)
  return info and info.name or "?"
end

local function classColor(classID)
  local info = C_CreatureInfo and C_CreatureInfo.GetClassInfo and C_CreatureInfo.GetClassInfo(classID or 0)
  local c = info and RAID_CLASS_COLORS and RAID_CLASS_COLORS[info.classFile]
  return c and c.r or 1, c and c.g or 1, c and c.b or 1
end

-- Sorts bounties by a column; ties and missing values fall back to the bounty number.
function ns.SortBounties(list, key, descending)
  table.sort(list, function(a, b)
    local x, y = a[key] or "", b[key] or ""
    if type(x) ~= type(y) then x, y = tostring(x), tostring(y) end
    if x == y then return a.id < b.id end
    if descending then return x > y end
    return x < y
  end)
  return list
end

-- ---------------------------------------------------------------- rows

-- "Add to Bounty…" from the board: what the code needs comes from the pack, no target required.
local function addGold(b)
  ns.OpenAmountEntry({
    guid = b.guid, name = b.name, classID = b.classID or 0, raceID = 0, level = 0,
    faction = b.faction, factionName = FACTION_NAME[b.faction] or "?",
  }, nil, nil, b.id)
end

local function bountyTooltip(tip, b)
  tip:SetText(b.name, classColor(b.classID))
  tip:AddLine(L.TIP_REWARD:format(ns.FormatGold(b.reward), b.poster or "?"), 1, 0.82, 0)
  for _, line in ipairs(ns.TermsLines(b)) do tip:AddLine(line, 1, 0.82, 0) end
  if b.pending then
    tip:AddLine(L.TIP_PENDING, 0.9, 0.9, 0.9, true)
  else
    local seen = ns.LastSeen(b.id)
    local text = seen and L.TIP_SEEN:format(zoneName(seen.map), ns.Ago(seen.t)) or L.NOT_SEEN
    if seen and seen.by and seen.by ~= "" then text = text .. L.TIP_SEEN_BY:format(seen.by) end
    tip:AddLine(text, 0.9, 0.9, 0.9)
    tip:AddLine(L.TIP_EXPIRES:format(date("%b %d", b.expires)), 0.9, 0.9, 0.9)
    tip:AddLine(b.claimed and L.CLAIMED or ns.HasTerms(b) and "" or L.TIP_ADD, 0.6, 0.6, 0.6)
  end
end

local function bountyRows(mineOnly)
  local me = ns.FullName("player")
  local list = {}
  for _, b in ipairs(ns.ListBounties()) do
    if not mineOnly or b.poster == me then list[#list + 1] = b end
  end
  ns.SortBounties(list, frame.sortKey, frame.sortDesc)
  local rows = {}
  for i, b in ipairs(list) do
    local seen = not b.pending and ns.LastSeen(b.id) or nil
    rows[i] = {
      cells = {
        b.pending and L.NEW_SHORT or b.id, b.name, ns.FormatGold(b.reward), b.poster,
        b.claimed and L.CLAIMED or seen and ("%s · %s"):format(zoneName(seen.map), ns.Ago(seen.t)) or L.NOT_SEEN,
        b.pending and L.PENDING or date("%b %d", b.expires),
      },
      nameColor = { classColor(b.classID) },
      dim = b.claimed,
      focus = not b.pending and b.id == frame.focusId,
      tooltip = function(tip) bountyTooltip(tip, b) end,
      onClick = function(self, mouse)
        -- A bounty with its own terms takes no added gold, so it has no menu.
        if mouse ~= "RightButton" or b.pending or b.claimed or ns.HasTerms(b) then return end
        if not (MenuUtil and MenuUtil.CreateContextMenu) then return end
        MenuUtil.CreateContextMenu(self, function(_, root)
          root:CreateTitle(b.name)
          root:CreateButton(L.MENU_ADD, function() addGold(b) end)
        end)
      end,
    }
  end
  return rows
end

-- Open Seasons (spec 5.11) have their own table above the bounties.
local SEASON_HEADS = { "#", L.COL_GUILD, L.COL_TERMS, L.COL_DECLARED, L.COL_POT, L.COL_ENDS }
local SEASON_ROWS = 4 -- visible rows; more scroll

local function seasonTooltip(tip, s)
  tip:SetText(L.TIP_SEASON_TITLE:format(s.guild), 1, 0.2, 0.15)
  tip:AddLine(L.TIP_REWARD:format(ns.SeasonTerms(s), s.poster ~= "" and s.poster or "?"), 1, 0.82, 0)
  if s.kind == ns.SEASON_KIND.pot then tip:AddLine(L.TIP_SEASON_POT:format(ns.FormatGold(s.remaining or 0)), 0.9, 0.9, 0.9) end
  tip:AddLine(L.TIP_SEASON_RULE, 0.9, 0.9, 0.9, true)
  tip:AddLine(s.pending and L.TIP_PENDING or L.TIP_EXPIRES:format(date("%b %d", s.expires)), 0.9, 0.9, 0.9, true)
  tip:AddLine(L.TIP_SEASON_ADD, 0.6, 0.6, 0.6, true)
end

-- "1,875g left", "prize pool", "no ceiling"
local function potCell(s)
  if s.kind == ns.SEASON_KIND.pot then return L.SEASON_POT_LEFT:format(ns.FormatGold(s.remaining or 0)) end
  if s.kind == ns.SEASON_KIND.pool then return L.SEASON_KIND_SHORT_2 end
  return L.SEASON_KIND_SHORT_3
end

local function seasonRows(mineOnly)
  local me = ns.FullName("player")
  local rows = {}
  for _, s in ipairs(ns.ListSeasons()) do
    if not mineOnly or s.poster == me then
      rows[#rows + 1] = {
        cells = {
          s.pending and L.NEW_SHORT or s.id, ("<%s>"):format(s.guild), ns.SeasonTerms(s), s.poster, potCell(s),
          s.pending and L.PENDING or date("%b %d", s.expires),
        },
        nameColor = { 1, 0.2, 0.15 },
        tooltip = function(tip) seasonTooltip(tip, s) end,
      }
    end
  end
  return rows
end

local function killRows()
  local rows = {}
  for i, k in ipairs(BountyLineCharDB.kills or {}) do
    local label = (k.bountyId or 0) > 0 and ("Bounty #%d"):format(k.bountyId) or L.BOUNTY_PENDING
    local name = k.name or label
    rows[i] = {
      cells = {
        (k.bountyId or 0) > 0 and k.bountyId or L.NEW_SHORT, name, k.reward and ns.FormatGold(k.reward) or "", "",
        date("%b %d %H:%M", k.t), k.shot and L.YES or L.NO,
      },
      nameColor = { 1, 1, 1 },
      tooltip = function(tip)
        tip:SetText(name)
        tip:AddLine(L.TIP_KILL, 0.9, 0.9, 0.9, true)
      end,
      onClick = function()
        ns.ShowCode({
          title = L.KILL_TITLE,
          subtitle = ("%s · %s"):format(name, label),
          instructions = L.KILL_POST,
          code = k.code,
          line = { "K", name, label },
          note = k.shot and L.SCREENSHOT_SAVED or L.SCREENSHOT_FAILED,
        })
      end,
    }
  end
  return rows
end

local function makeRow(parent, i)
  local r = CreateFrame("Button", nil, parent)
  r:SetHeight(ROW_H)
  r:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
  r:SetPoint("RIGHT")
  r:RegisterForClicks("AnyUp")
  r.shade = r:CreateTexture(nil, "BACKGROUND")
  r.shade:SetAllPoints()
  r.stripe = i % 2 == 0 and 0.25 or 0.1
  local hover = r:CreateTexture(nil, "HIGHLIGHT")
  hover:SetAllPoints()
  hover:SetColorTexture(1, 1, 1, 0.07)
  r.cells = {}
  for c, col in ipairs(COLS) do
    local fs = r:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    fs:SetPoint("LEFT", col[1], 0)
    fs:SetWidth(col[2])
    fs:SetJustifyH("LEFT")
    fs:SetWordWrap(false)
    r.cells[c] = fs
  end
  r:SetScript("OnEnter", function(self)
    if not self.data or not self.data.tooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    self.data.tooltip(GameTooltip)
    GameTooltip:Show()
  end)
  r:SetScript("OnLeave", function() GameTooltip:Hide() end)
  r:SetScript("OnClick", function(self, mouse)
    if self.data and self.data.onClick then self.data.onClick(self, mouse) end
  end)
  return r
end

-- ---------------------------------------------------------------- tables

-- One scrollable table: a title, clickable column headers, rows and an "empty" line.
-- onSort(i): a header was clicked (nil = not sortable).
local function makeTable(c, onSort)
  local t = { rows = {} }
  t.title = ns.Text(c, "section", 14)
  t.heads = {}
  for i, col in ipairs(COLS) do
    local h = CreateFrame("Button", nil, c)
    h:SetSize(col[2], 20)
    h.text = ns.Text(h, "section", 12)
    h.text:SetPoint("LEFT", 8, 0)
    h.x = 12 + col[1]
    if onSort then h:SetScript("OnClick", function() onSort(i) end) end
    t.heads[i] = h
  end
  t.scroll = CreateFrame("ScrollFrame", nil, c, "UIPanelScrollFrameTemplate")
  t.list = CreateFrame("Frame", nil, t.scroll)
  t.list:SetSize(680, 1)
  t.scroll:SetScrollChild(t.list)
  t.empty = ns.Text(c, "body", 14)
  t.empty:SetPoint("TOP", t.scroll, "TOP", 0, -12)
  t.empty:SetWidth(560)
  t.empty:SetJustifyH("CENTER")
  t.empty:SetSpacing(6)
  return t
end

-- Places a table: its title at `top` (px below the content's top), then the headers, then a
-- scrolling list either `height` tall or down to the buttons (height nil).
local function placeTable(t, c, top, height)
  t.title:ClearAllPoints()
  t.title:SetPoint("TOPLEFT", 16, -top)
  for _, h in ipairs(t.heads) do
    h:ClearAllPoints()
    h:SetPoint("TOPLEFT", h.x, -(top + 20))
  end
  t.scroll:ClearAllPoints()
  t.scroll:SetPoint("TOPLEFT", 12, -(top + 42))
  if height then
    t.scroll:SetPoint("RIGHT", c, "RIGHT", -30, 0)
    t.scroll:SetHeight(height)
  else
    t.scroll:SetPoint("BOTTOMRIGHT", -30, 48)
  end
end

local function showTable(t, shown)
  t.title:SetShown(shown)
  t.scroll:SetShown(shown)
  t.empty:SetShown(shown)
  for _, h in ipairs(t.heads) do h:SetShown(shown) end
end

local function fillTable(t, rows, heads, arrows)
  for i, h in ipairs(t.heads) do h.text:SetText(heads[i] .. (arrows and arrows[i] or "")) end
  for i, data in ipairs(rows) do
    local r = t.rows[i] or makeRow(t.list, i)
    t.rows[i] = r
    r.data = data
    -- The bounty opened from "View Bounty" is highlighted in gold.
    if data.focus then r.shade:SetColorTexture(1, 0.82, 0.25, 0.22) else r.shade:SetColorTexture(0, 0, 0, r.stripe) end
    r:SetAlpha(data.dim and 0.5 or 1)
    for col = 1, #COLS do r.cells[col]:SetText(data.cells[col] or "") end
    r.cells[2]:SetTextColor(data.nameColor[1], data.nameColor[2], data.nameColor[3])
    r.cells[3]:SetTextColor(1, 0.82, 0)
    r:Show()
  end
  for i = #rows + 1, #t.rows do t.rows[i]:Hide() end
  t.list:SetHeight(math.max(1, #rows * ROW_H))
end

-- ---------------------------------------------------------------- window

local function build()
  local f = ns.CreateWindow("BountyLineBoard", 760, 620, L.ADDON)
  local c = f.content
  f.tab, f.sortKey, f.sortDesc = "wanted", "reward", true

  f.heading = ns.Text(c, "heading")
  f.heading:SetPoint("TOPLEFT", 16, -12)
  f.summary = ns.Text(c, "muted", 13)
  f.summary:SetPoint("TOPLEFT", f.heading, "BOTTOMLEFT", 0, -4)
  f.summary:SetPoint("RIGHT", -16, 0)

  -- Tabs, top right.
  f.tabs = {}
  for i, tab in ipairs(TABS) do
    local b = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
    b:SetSize(112, 22)
    b:SetPoint("TOPRIGHT", -14 - (#TABS - i) * 116, -12)
    b:SetText(tab[2])
    b:SetScript("OnClick", function()
      f.tab, f.focusId = tab[1], nil
      ns.RefreshBoard()
    end)
    f.tabs[tab[1]] = b
  end

  -- Open Seasons on top (not sortable), bounties or kills below (click a header to sort).
  f.seasons = makeTable(c, nil)
  f.main = makeTable(c, function(i)
    local key = SORT_KEYS[i]
    if f.tab == "kills" or not key then return end
    if f.sortKey == key then f.sortDesc = not f.sortDesc else f.sortKey, f.sortDesc = key, key == "reward" end
    ns.RefreshBoard()
  end)

  local function button(text, offset, onClick)
    local b = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
    b:SetSize(140, 24)
    b:SetPoint("BOTTOM", c, "BOTTOM", offset, 12)
    b:SetText(text)
    b:SetScript("OnClick", onClick)
  end
  button(L.IMPORT_BUTTON, -148, function() ns.OpenImport() end)
  button(L.OPT_BUTTON, 0, function() ns.OpenOptions() end)
  button(L.CLOSE, 148, function() f:Hide() end)
  return f
end

local TOP = 60
local SEASON_HEIGHT = SEASON_ROWS * ROW_H

function ns.RefreshBoard()
  if not frame or not frame:IsShown() then return end
  local tab = frame.tab
  local pack = BountyLineDB.pack
  local c = frame.content
  local kills = tab == "kills"
  local rows = kills and killRows() or bountyRows(tab == "mine")
  local seasons = kills and {} or seasonRows(tab == "mine")

  for key, b in pairs(frame.tabs) do
    if key == tab then b:LockHighlight() else b:UnlockHighlight() end
  end

  -- Two tables on the bounty tabs; the kills tab uses the whole height for one.
  showTable(frame.seasons, not kills)
  if kills then
    placeTable(frame.main, c, TOP)
  else
    placeTable(frame.seasons, c, TOP, SEASON_HEIGHT)
    placeTable(frame.main, c, TOP + 42 + SEASON_HEIGHT + 14)
    frame.seasons.title:SetText(L.SEASONS_TABLE:format(#seasons))
    frame.seasons.empty:SetText(#seasons == 0 and (tab == "mine" and L.SEASONS_MINE_EMPTY or L.SEASONS_EMPTY) or "")
    fillTable(frame.seasons, seasons, SEASON_HEADS)
  end

  local arrows = {}
  for i in ipairs(COLS) do
    arrows[i] = not kills and SORT_KEYS[i] == frame.sortKey and (frame.sortDesc and " v" or " ^") or ""
  end
  fillTable(frame.main, rows, kills and KILL_HEADS or BOUNTY_HEADS, arrows)
  local main = frame.main

  if kills then
    frame.heading:SetText(L.TAB_KILLS)
    frame.summary:SetText(L.KILLS_SUMMARY:format(#rows))
    main.title:SetText(L.KILLS_TABLE)
    main.empty:SetText(#rows == 0 and L.KILLS_EMPTY or "")
  elseif tab == "mine" then
    frame.heading:SetText(L.TAB_MINE)
    frame.summary:SetText(L.MINE_SUMMARY:format(#rows))
    main.title:SetText(L.BOUNTIES_TABLE:format(#rows))
    main.empty:SetText(#rows == 0 and L.MINE_EMPTY or "")
  else
    frame.heading:SetText(L.BOARD_TITLE)
    main.title:SetText(L.BOUNTIES_TABLE:format(#rows))
    if pack then
      -- A pack more than a day old is probably missing bounties: nudge a re-import.
      local stale = GetServerTime() - pack.version > 86400 and L.PACK_STALE or ""
      frame.summary:SetText(L.BOARD_SUMMARY:format(#rows, ns.BoardName(), ns.Ago(pack.version)) .. stale)
    else
      frame.summary:SetText("")
    end
    -- A guildie has a newer Bounty Line: say so here until this one is updated.
    local newer = ns.NewerVersion()
    if newer then frame.summary:SetText(L.UPDATE_SHORT:format(newer)) end
    main.empty:SetText(#rows > 0 and "" or pack and L.LIST_EMPTY or L.FIRST_RUN)
  end
end

-- focusId: highlight that bounty's row (from the right-click menu's "View Bounty").
-- tab: "wanted" (default), "mine" or "kills".
function ns.OpenBoard(focusId, tab)
  frame = frame or build()
  frame.focusId = focusId
  frame.tab = tab or (focusId and "wanted") or frame.tab
  frame:Show()
  ns.RefreshBoard()
end
