-- Proof stamp (spec 9.2): shown for the screenshot, full width at screen center. Built for
-- the AI stamp reader in Phase 6: plain font, white on a dark band, the full kill code.
local _, ns = ...
local L = ns.L

local FONT = "Fonts\\ARIALN.TTF"
local frame

local function line(parent, size, y, r, g, b)
  local fs = parent:CreateFontString(nil, "OVERLAY")
  fs:SetFont(FONT, size, "")
  fs:SetPoint("TOP", 0, y)
  fs:SetTextColor(r or 1, g or 1, b or 1)
  return fs
end

local function build()
  local f = CreateFrame("Frame", "BountyLineStamp", UIParent)
  f:SetFrameStrata("FULLSCREEN_DIALOG")
  f:SetPoint("LEFT", 0, 0)
  f:SetPoint("RIGHT", 0, 0)
  f:SetHeight(170)
  local band = f:CreateTexture(nil, "BACKGROUND")
  band:SetAllPoints()
  band:SetColorTexture(0, 0, 0, 0.88)
  for _, edge in ipairs({ "TOP", "BOTTOM" }) do
    local bar = f:CreateTexture(nil, "BORDER")
    bar:SetColorTexture(0.85, 0.08, 0.06, 1)
    bar:SetHeight(4)
    bar:SetPoint(edge .. "LEFT")
    bar:SetPoint(edge .. "RIGHT")
  end
  f.title = line(f, 30, -16, 1, 0.82, 0.25)
  f.target = line(f, 26, -54)
  f.place = line(f, 22, -88)
  f.code = line(f, 22, -122)
  f:Hide()
  return f
end

function ns.ShowStamp(k)
  frame = frame or build()
  frame.title:SetText(k.practice and L.STAMP_PRACTICE or L.STAMP_TITLE)
  frame.target:SetText(("%s · %s · %s"):format(k.bounty.name, ns.FormatGold(k.bounty.reward), ns.BountyLabel(k.bounty)))
  local zone = ns.ZoneName() or ""
  frame.place:SetText(("%s%s%s"):format(zone, zone ~= "" and " · " or "", date("%Y-%m-%d %H:%M:%S", k.killedAt)))
  frame.code:SetText(k.code)
  frame:Show()
end

function ns.HideStamp()
  if frame then frame:Hide() end
end
