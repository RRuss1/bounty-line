-- /bl import: paste the Bounty Pack (one code, or every part of a multi-part pack).
local _, ns = ...
local L = ns.L

local frame

local function refresh()
  local text = frame.box:GetText()
  local pack, err, message, received, total = ns.ReadPack(text)
  frame.pack = pack
  frame.import:SetEnabled(pack ~= nil)
  local c = ns.COLORS
  if pack then
    frame.status:SetTextColor(0.4, 1, 0.4)
    local board = pack.discordDisplayName ~= "" and pack.discordDisplayName or "?"
    frame.status:SetText(L.IMPORT_READY:format(#pack.bounties, board, pack.boardTag))
  elseif err == "EMPTY" then
    frame.status:SetTextColor(c.muted[1], c.muted[2], c.muted[3])
    frame.status:SetText(text:match("%S") and L.IMPORT_NO_CODE or "")
  elseif err == "INCOMPLETE" then
    frame.status:SetTextColor(c.gold[1], c.gold[2], c.gold[3])
    frame.status:SetText(L.IMPORT_PARTS:format(received and #received or 0, total or 0))
  else
    frame.status:SetTextColor(c.error[1], c.error[2], c.error[3])
    frame.status:SetText(err == "CHECKSUM" and L.IMPORT_CUT or (message or err))
  end
end

local function import()
  local pack = frame.pack
  if not pack then return end
  local ok, why = ns.StorePack(pack)
  if not ok and why == "OLDER" then return ns.Print(L.IMPORT_OLDER) end
  frame:Hide()
  ns.Print(L.IMPORTED:format(#pack.bounties, ns.BoardName()))
  if ns.PackOutdated() then ns.Print(L.OUTDATED) end
  ns.RefreshMarks()
  ns.RefreshBoard()
  ns.Comms.SharePack() -- everyone online in the guild gets it too
  ns.Print(L.SHARED)
end

local function build()
  local f = ns.CreateWindow("BountyLineImport", 578, 382, L.ADDON)
  local c = f.content

  local heading = ns.Text(c, "heading")
  heading:SetPoint("TOPLEFT", 16, -12)
  heading:SetText(L.IMPORT_TITLE)

  local help = ns.Text(c, "section", 13)
  help:SetPoint("TOPLEFT", 28, -48)
  help:SetPoint("RIGHT", -16, 0)
  help:SetText(L.IMPORT_HELP)

  local well = CreateFrame("Frame", nil, c, "BackdropTemplate")
  well:SetPoint("TOPLEFT", 16, -74)
  well:SetPoint("BOTTOMRIGHT", -16, 70)
  well:SetBackdrop({ bgFile = "Interface\\Buttons\\WHITE8x8", edgeFile = "Interface\\Buttons\\WHITE8x8", edgeSize = 1 })
  well:SetBackdropColor(0, 0, 0, 0.55)
  well:SetBackdropBorderColor(0.62, 0.47, 0.22, 0.8)

  local scroll = CreateFrame("ScrollFrame", nil, well, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 6, -6)
  scroll:SetPoint("BOTTOMRIGHT", -26, 6)
  local box = CreateFrame("EditBox", nil, scroll)
  box:SetMultiLine(true)
  box:SetAutoFocus(false)
  box:SetMaxLetters(0)
  box:SetFontObject("ChatFontNormal")
  box:SetWidth(460)
  box:SetScript("OnTextChanged", refresh)
  box:SetScript("OnEscapePressed", function() f:Hide() end)
  scroll:SetScrollChild(box)
  well:EnableMouse(true)
  well:SetScript("OnMouseDown", function() box:SetFocus() end)
  f.box = box

  f.status = ns.Text(c, "body", 14)
  f.status:SetPoint("BOTTOMLEFT", 18, 44)
  f.status:SetPoint("RIGHT", -16, 0)

  f.import = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  f.import:SetSize(120, 24)
  f.import:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -6, 12)
  f.import:SetText(L.IMPORT_BUTTON)
  f.import:SetScript("OnClick", import)

  local clear = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  clear:SetSize(120, 24)
  clear:SetPoint("BOTTOMLEFT", c, "BOTTOM", 6, 12)
  clear:SetText(L.CLEAR)
  clear:SetScript("OnClick", function() box:SetText("") box:SetFocus() end)
  return f
end

function ns.OpenImport()
  frame = frame or build()
  frame.box:SetText("")
  frame:Show()
  frame.box:SetFocus()
  refresh()
end
