-- The in-game Bounty Board (/bl, minimap click): open bounties from the imported pack, with
-- reward, poster, last sighting (yours or a guildie's) and expiry. Biggest reward first.
local _, ns = ...
local L = ns.L

local ROW_H = 26
local COLUMNS = { -- label, x offset, width
  { "#", 8, 34 }, { L.COL_TARGET, 46, 170 }, { L.COL_REWARD, 220, 80 }, { L.COL_POSTER, 304, 120 },
  { L.COL_SEEN, 428, 150 }, { L.COL_EXPIRES, 582, 70 },
}
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

local function row(parent, i)
  local r = CreateFrame("Frame", nil, parent)
  r:SetHeight(ROW_H)
  r:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
  r:SetPoint("RIGHT")
  local shade = r:CreateTexture(nil, "BACKGROUND")
  shade:SetAllPoints()
  shade:SetColorTexture(0, 0, 0, i % 2 == 0 and 0.25 or 0.1)
  r.cells = {}
  for c, col in ipairs(COLUMNS) do
    local fs = r:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    fs:SetPoint("LEFT", col[2], 0)
    fs:SetWidth(col[3])
    fs:SetJustifyH("LEFT")
    fs:SetWordWrap(false)
    r.cells[c] = fs
  end
  return r
end

local function build()
  local f = ns.CreateWindow("BountyLineBoard", 720, 470, L.ADDON)
  local c = f.content

  local heading = ns.Text(c, "heading")
  heading:SetPoint("TOPLEFT", 16, -12)
  heading:SetText(L.BOARD_TITLE)
  f.summary = ns.Text(c, "muted", 13)
  f.summary:SetPoint("TOPLEFT", heading, "BOTTOMLEFT", 0, -4)
  f.summary:SetPoint("RIGHT", -16, 0)

  -- Column headers
  local head = CreateFrame("Frame", nil, c)
  head:SetPoint("TOPLEFT", 12, -62)
  head:SetPoint("RIGHT", -30, 0)
  head:SetHeight(20)
  for _, col in ipairs(COLUMNS) do
    local fs = ns.Text(head, "section", 12)
    fs:SetPoint("LEFT", col[2] + 8, 0)
    fs:SetText(col[1])
  end

  local scroll = CreateFrame("ScrollFrame", nil, c, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 12, -84)
  scroll:SetPoint("BOTTOMRIGHT", -30, 48)
  local list = CreateFrame("Frame", nil, scroll)
  list:SetSize(640, 1)
  scroll:SetScrollChild(list)
  f.list, f.rows = list, {}

  f.empty = ns.Text(c, "body", 14)
  f.empty:SetPoint("TOP", scroll, "TOP", 0, -40)
  f.empty:SetWidth(520)
  f.empty:SetJustifyH("CENTER")

  local import = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  import:SetSize(140, 24)
  import:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -6, 12)
  import:SetText(L.IMPORT_BUTTON)
  import:SetScript("OnClick", function() ns.OpenImport() end)

  local close = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  close:SetSize(140, 24)
  close:SetPoint("BOTTOMLEFT", c, "BOTTOM", 6, 12)
  close:SetText(L.CLOSE)
  close:SetScript("OnClick", function() f:Hide() end)
  return f
end

function ns.RefreshBoard()
  if not frame or not frame:IsShown() then return end
  local list = ns.ListBounties()
  local pack = BountyLineDB.pack
  if pack then
    frame.summary:SetText(L.BOARD_SUMMARY:format(#list, ns.BoardName(), ns.Ago(pack.version)))
  else
    frame.summary:SetText("")
  end
  frame.empty:SetText(pack and (#list == 0 and L.LIST_EMPTY or "") or L.NO_PACK)

  for i, b in ipairs(list) do
    local r = frame.rows[i] or row(frame.list, i)
    frame.rows[i] = r
    local seen = ns.LastSeen(b.id)
    r.cells[1]:SetText(b.id)
    r.cells[2]:SetText(b.name)
    r.cells[2]:SetTextColor(classColor(b.classID))
    r.cells[3]:SetText(ns.FormatGold(b.reward))
    r.cells[3]:SetTextColor(1, 0.82, 0)
    r.cells[4]:SetText(b.poster)
    r.cells[5]:SetText(seen and ("%s · %s"):format(zoneName(seen.map), ns.Ago(seen.t)) or L.NOT_SEEN)
    r.cells[6]:SetText(date("%b %d", b.expires))
    r:Show()
  end
  for i = #list + 1, #frame.rows do frame.rows[i]:Hide() end
  frame.list:SetHeight(math.max(1, #list * ROW_H))
end

function ns.OpenBoard()
  frame = frame or build()
  frame:Show()
  ns.RefreshBoard()
end
