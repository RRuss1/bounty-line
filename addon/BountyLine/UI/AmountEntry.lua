-- "Set Bounty" box (spec 5.4b). Every amount is typed by hand; the button stays disabled
-- until the amounts are within the limits. The target was snapshotted before this opened.
--
-- Two modes, picked at the top: a bounty on this player, or an Open Season on their whole
-- guild (spec 5.11). The guild name comes from the snapshot and is never typed.
local _, ns = ...
local L = ns.L
local KIND = ns.SEASON_KIND

local frame
local BASE_HEIGHT, MODE_ROW, OPTIONS_ROW, HINT_ROW = 344, 32, 34, 18

local function blank(box) return box:GetText():match("^%s*$") ~= nil end

-- What would be posted, or nil and the error to show ("" while nothing is typed yet).
local function current()
  local min, max = ns.RewardLimits()
  local amount, why = ns.ParseReward(frame.amount:GetText(), min, max)
  if not amount then return nil, blank(frame.amount) and "" or ns.RewardError(why, min, max) end
  if not frame.guildMode then return { reward = amount } end
  if frame.season then return { kind = 0, per = 0, total = amount, days = 0 } end -- adding gold
  if frame.kind == KIND.pool then return { kind = KIND.pool, per = 0, total = amount, days = frame.days } end
  if frame.kind == KIND.open then return { kind = KIND.open, per = amount, total = 0, days = frame.days } end
  local pot, potWhy = ns.ParseReward(frame.total:GetText(), min, max)
  if not pot then return nil, blank(frame.total) and "" or ns.RewardError(potWhy, min, max) end
  if pot < amount then return nil, L.SEASON_POT_SMALL end
  return { kind = KIND.pot, per = amount, total = pot, days = frame.days }
end

-- The line under the limits: what the choice will cost.
local function hint(v)
  if not frame.guildMode then return "" end
  if frame.season then return L.SEASON_HINT_ADD:format(ns.SeasonLabel(frame.season), frame.season.guild) end
  if frame.kind == KIND.open then
    return L.SEASON_HINT_OPEN:format(v and ns.FormatGold(v.per) or "?", frame.days)
  end
  if frame.kind == KIND.pool then return L.SEASON_HINT_POOL:format(frame.days) end
  return v and L.SEASON_HINT_POT:format(math.floor(v.total / v.per), frame.days) or L.SEASON_HINT_POT_EMPTY:format(frame.days)
end

local function refresh()
  local v, err = current()
  frame.set:SetEnabled(v ~= nil)
  frame.error:SetText(v and "" or err or "")
  frame.hint:SetText(hint(v))
  -- No ceiling is the one choice with an open-ended bill: say so in the warning colour.
  local warn = frame.guildMode and not frame.season and frame.kind == KIND.open
  local c = warn and ns.COLORS.error or ns.COLORS.muted or { 0.7, 0.7, 0.7 }
  frame.hint:SetTextColor(c[1], c[2], c[3])
end

local function submit()
  local v = current()
  if not v then return end
  local snap, note = frame.snap, frame.note:GetText()
  local guildMode, season, existingId = frame.guildMode, frame.season, frame.existingId
  frame:Hide()
  if guildMode then
    ns.PostSeason(snap, v.kind, v.per, v.total, v.days, season and season.id or nil)
  else
    ns.PostBounty(snap, v.reward, note, existingId)
  end
end

-- Shows the rows for the current mode and sizes the window to fit them.
local function layout()
  local f = frame
  local guild, adding = f.guildMode, f.guildMode and f.season ~= nil
  local pot = guild and not adding and f.kind == KIND.pot
  local options = guild and not adding
  local shift = f.modeRow and MODE_ROW or 0

  f.playerButton:SetShown(f.modeRow)
  f.guildButton:SetShown(f.modeRow)
  if f.modeRow then
    if guild then
      f.guildButton:LockHighlight()
      f.playerButton:UnlockHighlight()
    else
      f.playerButton:LockHighlight()
      f.guildButton:UnlockHighlight()
    end
  end

  f.heading:SetText(adding and L.SEASON_ADD_HEADING or guild and L.SEASON_HEADING or f.existingId and L.ADD_TO_BOUNTY or L.SET_BOUNTY)
  f.set:SetText(adding and L.SEASON_ADD_BUTTON or guild and L.SEASON_BUTTON or L.SET_BUTTON)

  f.rewardLabel:ClearAllPoints()
  f.rewardLabel:SetPoint("TOPLEFT", 28, -84 - shift)
  f.rewardLabel:SetText(
    not guild and L.REWARD_LABEL
    or adding and L.SEASON_ADD_LABEL
    or f.kind == KIND.pool and L.SEASON_POOL_LABEL
    or L.SEASON_PER_KILL_LABEL)

  -- Second row: the note (a bounty), the pot (per head + pot), or nothing.
  f.note:SetShown(not guild)
  f.total:SetShown(pot)
  f.noteLabel:SetShown(not guild or pot)
  f.noteLabel:SetText(pot and L.SEASON_POT_LABEL or L.NOTE_LABEL)

  f.kindButton:SetShown(options)
  f.daysButton:SetShown(options)
  if options then
    f.kindButton:SetText(L["SEASON_KIND_" .. f.kind])
    f.daysButton:SetText(L.SEASON_DAYS:format(f.days))
  end

  f.limits:ClearAllPoints()
  f.limits:SetPoint("TOPLEFT", f.noteLabel, "BOTTOMLEFT", 0, -16 - (options and OPTIONS_ROW or 0))
  f:SetHeight(BASE_HEIGHT + shift + (options and OPTIONS_ROW or 0) + (guild and HINT_ROW or 0))

  -- The glow takes the target's class colour for a bounty on them; a whole guild gets the red.
  if guild then f:SetGlowColor() else f:SetGlowColor(ns.ClassColor(f.snap.classID)) end
  refresh()
end

local function setMode(guild)
  frame.guildMode = guild
  layout()
  frame.amount:SetFocus()
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

local function button(parent, width, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(width, 22)
  b:SetScript("OnClick", onClick)
  return b
end

local function build()
  local f = ns.CreateWindow("BountyLineAmountEntry", 478, BASE_HEIGHT, L.ADDON)
  local c = f.content

  local heading = ns.Text(c, "heading")
  f.heading = heading
  heading:SetPoint("TOPLEFT", 16, -12)
  heading:SetText(L.SET_BOUNTY)

  f.target = ns.Text(c, "body", 14)
  f.target:SetPoint("TOPLEFT", heading, "BOTTOMLEFT", 0, -6)
  f.target:SetPoint("RIGHT", -16, 0)

  -- This player, or their whole guild.
  f.playerButton = button(c, 120, function() setMode(false) end)
  f.playerButton:SetPoint("TOPLEFT", 28, -78)
  f.playerButton:SetText(L.SEASON_MODE_PLAYER)
  f.guildButton = button(c, 280, function() setMode(true) end)
  f.guildButton:SetPoint("LEFT", f.playerButton, "RIGHT", 8, 0)

  f.rewardLabel = ns.Text(c, "section", 14)
  f.rewardLabel:SetPoint("TOPLEFT", 28, -84)
  f.rewardLabel:SetText(L.REWARD_LABEL)
  f.amount = input(f, c, 110, 12)
  f.amount:SetPoint("LEFT", f.rewardLabel, "LEFT", 150, 0)
  f.amount:SetScript("OnTextChanged", refresh)

  f.noteLabel = ns.Text(c, "section", 14)
  f.noteLabel:SetPoint("TOPLEFT", f.rewardLabel, "BOTTOMLEFT", 0, -20)
  f.noteLabel:SetText(L.NOTE_LABEL)
  f.note = input(f, c, 250, 80) -- 80 = the code's note limit (Compendium 02)
  f.note:SetPoint("LEFT", f.noteLabel, "LEFT", 150, 0)
  f.total = input(f, c, 110, 12) -- the pot of an Open Season, in the note's place
  f.total:SetPoint("LEFT", f.noteLabel, "LEFT", 150, 0)
  f.total:SetScript("OnTextChanged", refresh)
  local function second() return f.total:IsShown() and f.total or f.note end
  f.amount:SetScript("OnTabPressed", function() second():SetFocus() end)
  f.note:SetScript("OnTabPressed", function() f.amount:SetFocus() end)
  f.total:SetScript("OnTabPressed", function() f.amount:SetFocus() end)

  -- Open Season only: which kind, and for how long. Each click moves to the next choice.
  f.kindButton = button(c, 250, function()
    f.kind = f.kind % 3 + 1
    layout()
  end)
  f.kindButton:SetPoint("TOPLEFT", f.noteLabel, "BOTTOMLEFT", 0, -14)
  f.daysButton = button(c, 110, function()
    local days = ns.SEASON_DAYS
    for i, d in ipairs(days) do
      if d == f.days then
        f.days = days[i % #days + 1]
        break
      end
    end
    layout()
  end)
  f.daysButton:SetPoint("LEFT", f.kindButton, "RIGHT", 8, 0)

  f.limits = ns.Text(c, "muted", 13)
  f.limits:SetPoint("TOPLEFT", f.noteLabel, "BOTTOMLEFT", 0, -16)
  f.error = c:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  f.error:SetTextColor(ns.COLORS.error[1], ns.COLORS.error[2], ns.COLORS.error[3])
  f.error:SetPoint("TOPLEFT", f.limits, "BOTTOMLEFT", 0, -6) -- its own row
  f.hint = ns.Text(c, "muted", 13)
  f.hint:SetPoint("TOPLEFT", f.error, "BOTTOMLEFT", 0, -4)
  f.hint:SetPoint("RIGHT", -16, 0)
  f.hint:SetJustifyH("LEFT")

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

-- What the guild button offers for this target, and whether it can be clicked.
local function guildChoice(snap)
  if snap.guildHidden then return L.SEASON_GUILD_HIDDEN, false end
  if not snap.guild or snap.guild == "" then return L.SEASON_NO_GUILD, false end
  local season = ns.GetSeason(snap.guild)
  if not season then return L.SEASON_MODE_GUILD:format(snap.guild), true end
  -- One Open Season per guild: a running one can only take more gold, and only once the
  -- Bounty Board has numbered it and if it has a pot or a pool to add to.
  if season.id == 0 or season.kind == KIND.open then return L.SEASON_RUNNING:format(snap.guild), false end
  return L.SEASON_MODE_ADD:format(snap.guild), true, season
end

-- existingId: "Add to Bounty…" on that open bounty (no guild choice then).
function ns.OpenAmountEntry(snap, amount, note, existingId)
  frame = frame or build()
  frame.snap = snap
  frame.existingId = existingId
  frame.guildMode = false
  frame.kind, frame.days = KIND.pot, ns.SEASON_DAYS[1]
  local min, max = ns.RewardLimits()
  -- The target's name takes their class colour (the glow does too, in layout()).
  local r, g, b = ns.ClassColor(snap.classID)
  local text = ns.Describe(snap)
  if snap.guild and snap.guild ~= "" then text = ("%s\n<%s>"):format(text, snap.guild) end
  if r and text:sub(1, #snap.name) == snap.name then
    local byte = function(v) return math.floor(v * 255 + 0.5) end
    text = ("|cff%02x%02x%02x%s|r%s"):format(byte(r), byte(g), byte(b), snap.name, text:sub(#snap.name + 1))
  end
  frame.target:SetText(text)
  frame.limits:SetText(L.LIMITS:format(ns.FormatGold(min), ns.FormatGold(max)))
  frame.amount:SetText(amount or "")
  frame.note:SetText(note or "")
  frame.total:SetText("")

  -- The guild choice: only for a new bounty, and only for a player whose guild we can read.
  frame.modeRow = existingId == nil
  local label, enabled, season = guildChoice(snap)
  frame.season = season
  frame.guildButton:SetText(label)
  frame.guildButton:SetEnabled(enabled)

  frame:Show()
  layout()
  frame.amount:SetFocus()
end
