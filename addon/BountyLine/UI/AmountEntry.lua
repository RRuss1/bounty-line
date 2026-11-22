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
  if reward or frame.amount:GetText():match("^%s*$") then
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
  ns.PostBounty(snap, reward, note, frame.existingId)
end

local function input(f, parent, width, maxLetters)
  local box = CreateFrame("EditBox", nil, parent, "InputBoxTemplate")
  box:SetSize(width, 26)
  box:SetAutoFocus(false)
  box:SetMaxLetters(maxLetters)
  box:SetScript("OnEscapePressed", function() f:Hide() end)
  box:SetScript("OnEnterPressed", submit)
  return box
end

local function build()
  local f = ns.CreateWindow("BountyLineAmountEntry", 478, 344, L.ADDON)
  local c = f.content

  local heading = ns.Text(c, "heading")
  f.heading = heading
  heading:SetPoint("TOPLEFT", 16, -12)
  heading:SetText(L.SET_BOUNTY)

  f.target = ns.Text(c, "body", 14)
  f.target:SetPoint("TOPLEFT", heading, "BOTTOMLEFT", 0, -6)
  f.target:SetPoint("RIGHT", -16, 0)

  local rewardLabel = ns.Text(c, "section", 14)
  rewardLabel:SetPoint("TOPLEFT", 28, -84)
  rewardLabel:SetText(L.REWARD_LABEL)
  f.amount = input(f, c, 110, 12)
  f.amount:SetPoint("LEFT", rewardLabel, "LEFT", 130, 0)
  f.amount:SetScript("OnTextChanged", refresh)

  local noteLabel = ns.Text(c, "section", 14)
  noteLabel:SetPoint("TOPLEFT", rewardLabel, "BOTTOMLEFT", 0, -20)
  noteLabel:SetText(L.NOTE_LABEL)
  f.note = input(f, c, 250, 80) -- 80 = the code's note limit (Compendium 02)
  f.note:SetPoint("LEFT", noteLabel, "LEFT", 130, 0)
  f.amount:SetScript("OnTabPressed", function() f.note:SetFocus() end)
  f.note:SetScript("OnTabPressed", function() f.amount:SetFocus() end)

  f.limits = ns.Text(c, "muted", 13)
  f.limits:SetPoint("TOPLEFT", noteLabel, "BOTTOMLEFT", 0, -16)
  f.error = c:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  f.error:SetTextColor(ns.COLORS.error[1], ns.COLORS.error[2], ns.COLORS.error[3])
  f.error:SetPoint("TOPLEFT", f.limits, "BOTTOMLEFT", 0, -6) -- its own row

  f.set = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  f.set:SetSize(120, 24)
  f.set:SetPoint("BOTTOMRIGHT", c, "BOTTOM", -6, 12)
  f.set:SetText(L.SET_BUTTON)
  f.set:SetScript("OnClick", submit)

  local cancel = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  cancel:SetSize(120, 24)
  cancel:SetPoint("BOTTOMLEFT", c, "BOTTOM", 6, 12)
  cancel:SetText(L.CANCEL)
  cancel:SetScript("OnClick", function() f:Hide() end)

  return f
end

-- existingId: "Add to Bounty…" on that open bounty.
function ns.OpenAmountEntry(snap, amount, note, existingId)
  frame = frame or build()
  frame.snap = snap
  frame.existingId = existingId
  frame.heading:SetText(existingId and L.ADD_TO_BOUNTY or L.SET_BOUNTY)
  local min, max = ns.RewardLimits()
  -- The glow and the target's name take the target's class colour (red when the class isn't known).
  local r, g, b = ns.ClassColor(snap.classID)
  local text = ns.Describe(snap)
  if r and text:sub(1, #snap.name) == snap.name then
    local byte = function(v) return math.floor(v * 255 + 0.5) end
    text = ("|cff%02x%02x%02x%s|r%s"):format(byte(r), byte(g), byte(b), snap.name, text:sub(#snap.name + 1))
  end
  frame.target:SetText(text)
  frame:SetGlowColor(r, g, b)
  frame.limits:SetText(L.LIMITS:format(ns.FormatGold(min), ns.FormatGold(max)))
  frame.amount:SetText(amount or "")
  frame.note:SetText(note or "")
  frame:Show()
  frame.amount:SetFocus()
  refresh()
end
