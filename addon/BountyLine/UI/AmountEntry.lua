-- "Set Bounty" amount box (spec 5.4b). The amount is always typed by hand; Set Bounty stays
-- disabled until it's within the limits. The target was snapshotted before this opened.
local _, ns = ...
local L = ns.L

local frame

local function current()
  local min, max = ns.RewardLimits()
  return ns.ParseReward(frame.amount:GetText(), min, max)
end

local function refresh()
  local reward, why = current()
  frame.set:SetEnabled(reward ~= nil)
  local text = frame.amount:GetText()
  if reward or text:match("^%s*$") then
    frame.error:SetText("")
  else
    local min, max = ns.RewardLimits()
    frame.error:SetText(ns.RewardError(why, min, max))
  end
end

local function submit()
  local reward = current()
  if not reward then return end
  local snap, note = frame.snap, frame.note:GetText()
  frame:Hide()
  ns.PostBounty(snap, reward, note)
end

local function input(parent, width, maxLetters)
  local box = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
  box:SetSize(width, 24)
  box:SetAutoFocus(false)
  box:SetMaxLetters(maxLetters)
  box:SetScript("OnEscapePressed", function() parent:Hide() end)
  box:SetScript("OnEnterPressed", submit)
  return box
end

local function build()
  local f = CreateFrame("Frame", "BountyLineAmountEntry", UIParent, "BackdropTemplate")
  f:SetSize(400, 200)
  f:SetPoint("CENTER", 0, 120)
  f:SetFrameStrata("DIALOG")
  f:SetToplevel(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving)
  f:SetScript("OnDragStop", f.StopMovingOrSizing)
  f:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  tinsert(UISpecialFrames, "BountyLineAmountEntry")

  local icon = f:CreateTexture(nil, "ARTWORK")
  icon:SetSize(28, 28)
  icon:SetPoint("TOPLEFT", 22, -20)
  icon:SetTexture("Interface\\TargetingFrame\\UI-RaidTargetingIcon_8")

  local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("LEFT", icon, "RIGHT", 8, 0)
  title:SetText(L.SET_BOUNTY)

  f.target = f:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  f.target:SetPoint("TOPLEFT", icon, "BOTTOMLEFT", 0, -8)

  local rewardLabel = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  rewardLabel:SetPoint("TOPLEFT", f.target, "BOTTOMLEFT", 0, -16)
  rewardLabel:SetText(L.REWARD_LABEL)
  f.amount = input(f, 100, 12)
  f.amount:SetPoint("LEFT", rewardLabel, "RIGHT", 14, 0)
  f.amount:SetScript("OnTextChanged", refresh)

  local noteLabel = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  noteLabel:SetPoint("TOPLEFT", rewardLabel, "BOTTOMLEFT", 0, -16)
  noteLabel:SetText(L.NOTE_LABEL)
  f.note = input(f, 200, 80) -- 80 = the code's note limit (Compendium 02)
  f.note:SetPoint("LEFT", noteLabel, "RIGHT", 14, 0)
  f.amount:SetScript("OnTabPressed", function() f.note:SetFocus() end)
  f.note:SetScript("OnTabPressed", function() f.amount:SetFocus() end)

  f.limits = f:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
  f.limits:SetPoint("TOPLEFT", noteLabel, "BOTTOMLEFT", 0, -12)
  f.error = f:CreateFontString(nil, "ARTWORK", "GameFontRedSmall")
  f.error:SetPoint("LEFT", f.limits, "RIGHT", 12, 0)

  f.set = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.set:SetSize(110, 22)
  f.set:SetPoint("BOTTOMRIGHT", f, "BOTTOM", -6, 18)
  f.set:SetText(L.SET_BUTTON)
  f.set:SetScript("OnClick", submit)

  local cancel = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  cancel:SetSize(110, 22)
  cancel:SetPoint("BOTTOMLEFT", f, "BOTTOM", 6, 18)
  cancel:SetText(L.CANCEL)
  cancel:SetScript("OnClick", function() f:Hide() end)

  return f
end

function ns.OpenAmountEntry(snap, amount, note)
  frame = frame or build()
  frame.snap = snap
  local min, max = ns.RewardLimits()
  frame.target:SetText(ns.Describe(snap))
  frame.limits:SetText(L.LIMITS:format(ns.FormatGold(min), ns.FormatGold(max)))
  frame.amount:SetText(amount or "")
  frame.note:SetText(note or "")
  frame:Show()
  frame.amount:SetFocus()
  refresh()
end
