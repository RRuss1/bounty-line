-- "Set Bounty" box (spec 5.4b). Every amount is typed by hand; the button stays disabled
-- until the amounts are within the limits. The target was snapshotted before this opened.
--
-- Two modes, picked at the top: a bounty on this player, or an Open Season on their whole
-- guild (spec 5.11). The guild name comes from the snapshot and is never typed. In guild
-- mode the kind and the length are two stacks of tick boxes (one tick each), and the gold
-- fields sit below them.
local _, ns = ...
local L = ns.L
local KIND = ns.SEASON_KIND

local frame
local WIDTH = 580
local ROW = 36       -- one input row
local CHECK_ROW = 26 -- one tick box row
local GUILD_GREEN = { 0.25, 1, 0.25 } -- the game's guild chat colour
local LABEL_X, INPUT_X = 28, 210

local function blank(box) return box:GetText():match("^%s*$") ~= nil end

-- A whole number of kills, 1 to 1000, or nil.
local function parseKills(text)
  local n = tonumber((text or ""):match("^%s*(%d+)%s*$"))
  if n and n >= 1 and n <= 1000 then return n end
  return nil
end

-- What would be posted, or nil and the error to show ("" while nothing is typed yet).
local function current()
  local min, max = ns.RewardLimits()
  local amount, why = ns.ParseReward(frame.amount:GetText(), min, max)
  if not amount then return nil, blank(frame.amount) and "" or ns.RewardError(why, min, max) end
  if not frame.guildMode then return { reward = amount } end
  if frame.season then return { kind = 0, per = 0, total = amount, days = 0 } end -- adding gold
  if frame.kind == KIND.open then return { kind = KIND.open, per = amount, total = 0, days = frame.days } end
  if frame.kind == KIND.pool then
    local kills = parseKills(frame.second:GetText())
    if not kills then return nil, blank(frame.second) and "" or L.SEASON_MIN_KILLS_BAD end
    return { kind = KIND.pool, per = 0, total = amount, days = frame.days, minKills = kills }
  end
  local pot, potWhy = ns.ParseReward(frame.second:GetText(), min, max)
  if not pot then return nil, blank(frame.second) and "" or ns.RewardError(potWhy, min, max) end
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
  if frame.kind == KIND.pool then
    return L.SEASON_HINT_POOL_MIN:format(v and v.minKills or "?", frame.days)
  end
  return v and L.SEASON_HINT_POT:format(math.floor(v.total / v.per), frame.days) or L.SEASON_HINT_POT_EMPTY:format(frame.days)
end

local function refresh()
  local v, err = current()
  frame.set:SetEnabled(v ~= nil)
  frame.error:SetText(v and "" or err or "")
  frame.hint:SetText(hint(v))
  -- No ceiling is the one choice with an open-ended bill: say so in the warning colour.
  local warn = frame.guildMode and not frame.season and frame.kind == KIND.open
  local c = warn and ns.COLORS.error or ns.COLORS.muted
  frame.hint:SetTextColor(c[1], c[2], c[3])
end

local function submit()
  local v = current()
  if not v then return end
  local snap, note = frame.snap, frame.note:GetText()
  local guildMode, season, existingId = frame.guildMode, frame.season, frame.existingId
  frame:Hide()
  if guildMode then
    ns.PostSeason(snap, v.kind, v.per, v.total, v.days, season and season.id or nil, v.minKills)
  else
    ns.PostBounty(snap, v.reward, note, existingId)
  end
end

local function place(widget, x, y)
  widget:ClearAllPoints()
  widget:SetPoint("TOPLEFT", frame.content, "TOPLEFT", x, y)
end

-- Shows the rows for the current mode, top to bottom, and sizes the window to fit them.
local function layout()
  local f = frame
  local guild, adding = f.guildMode, f.guildMode and f.season ~= nil
  local choosing = guild and not adding -- the kind and length stacks
  local y = -88

  -- This player / Their guild.
  f.playerButton:SetShown(f.modeRow)
  f.guildButton:SetShown(f.modeRow)
  if f.modeRow then
    place(f.playerButton, LABEL_X, y)
    if guild then
      f.guildButton:LockHighlight()
      f.playerButton:UnlockHighlight()
    else
      f.playerButton:LockHighlight()
      f.guildButton:UnlockHighlight()
    end
    y = y - 36
  end

  -- Kind (left) and length (right): one tick in each stack.
  for i, box in ipairs(f.kindChecks) do
    box:SetShown(choosing)
    box:SetChecked(f.kind == i)
    if choosing then place(box, LABEL_X, y - (i - 1) * CHECK_ROW) end
  end
  for i, box in ipairs(f.dayChecks) do
    box:SetShown(choosing)
    box:SetChecked(f.days == ns.SEASON_DAYS[i])
    if choosing then place(box, 390, y - (i - 1) * CHECK_ROW) end
  end
  if choosing then y = y - 3 * CHECK_ROW - 14 end

  f.heading:SetText(adding and L.SEASON_ADD_HEADING or guild and L.SEASON_HEADING or f.existingId and L.ADD_TO_BOUNTY or L.SET_BOUNTY)
  f.set:SetText(adding and L.SEASON_ADD_BUTTON or guild and L.SEASON_BUTTON or L.SET_BUTTON)

  -- First row: the gold.
  place(f.amountLabel, LABEL_X, y - 4)
  f.amount:ClearAllPoints()
  f.amount:SetPoint("LEFT", f.amountLabel, "LEFT", INPUT_X - LABEL_X, 0)
  f.amountLabel:SetText(
    not guild and L.REWARD_LABEL
    or adding and L.SEASON_ADD_LABEL
    or f.kind == KIND.pool and L.SEASON_POOL_LABEL
    or L.SEASON_PER_KILL_LABEL)
  y = y - ROW

  -- Second row: the note (a bounty), the pot (per head + pot), the minimum (prize pool), or nothing.
  local second = choosing and (f.kind == KIND.pot or f.kind == KIND.pool)
  f.note:SetShown(not guild)
  f.second:SetShown(second)
  f.secondLabel:SetShown(not guild or second)
  if not guild or second then
    place(f.secondLabel, LABEL_X, y - 4)
    local box = guild and f.second or f.note
    box:ClearAllPoints()
    box:SetPoint("LEFT", f.secondLabel, "LEFT", INPUT_X - LABEL_X, 0)
    f.secondLabel:SetText(not guild and L.NOTE_LABEL or f.kind == KIND.pool and L.SEASON_MIN_KILLS_LABEL or L.SEASON_POT_LABEL)
    f.second:SetMaxLetters(f.kind == KIND.pool and 4 or 12)
    y = y - ROW
  end

  place(f.limits, LABEL_X, y - 6)
  f.limits:SetShown(true)
  y = y - 22
  place(f.error, LABEL_X, y - 4)
  y = y - 20
  f.hint:SetShown(guild)
  if guild then
    place(f.hint, LABEL_X, y - 2)
    f.hint:SetWidth(WIDTH - 2 * LABEL_X - 40)
    y = y - 34
  end

  -- Height: the rows above, the buttons and the window's frame (title bar, borders, margins).
  f:SetHeight(-y + 48 + 110) -- 110: the frame above and below the content panel (Window.lua)

  -- The glow: the target's class colour for a bounty on them, the game's guild green for a guild.
  if guild then
    f:SetGlowColor(GUILD_GREEN[1], GUILD_GREEN[2], GUILD_GREEN[3])
  else
    f:SetGlowColor(ns.ClassColor(f.snap.classID))
  end
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

-- A tick box with its label; clicking it (or the label) makes it the one ticked in its stack.
local function check(parent, text, onPick)
  local box = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
  box:SetSize(24, 24)
  local label = ns.Text(box, "body", 13)
  label:SetPoint("LEFT", box, "RIGHT", 4, 0)
  label:SetText(text)
  box:SetHitRectInsets(0, -(label:GetStringWidth() + 8), 0, 0) -- the label is clickable too
  box:SetScript("OnClick", onPick)
  return box
end

local function build()
  local f = ns.CreateWindow("BountyLineAmountEntry", WIDTH, 344, L.ADDON)
  local c = f.content

  local heading = ns.Text(c, "heading")
  f.heading = heading
  heading:SetPoint("TOPLEFT", 16, -12)
  heading:SetText(L.SET_BOUNTY)

  f.target = ns.Text(c, "body", 14)
  f.target:SetPoint("TOPLEFT", heading, "BOTTOMLEFT", 0, -6)
  f.target:SetPoint("RIGHT", -16, 0)
  f.target:SetJustifyH("LEFT")

  -- This player, or their whole guild.
  f.playerButton = button(c, 140, function() setMode(false) end)
  f.playerButton:SetText(L.SEASON_MODE_PLAYER)
  f.guildButton = button(c, WIDTH - 2 * LABEL_X - 140 - 8 - 40, function() setMode(true) end)
  f.guildButton:SetPoint("LEFT", f.playerButton, "RIGHT", 8, 0)

  -- Open Season: kind and length.
  f.kindChecks = {}
  for i = 1, 3 do
    f.kindChecks[i] = check(c, L["SEASON_KIND_" .. i], function()
      f.kind = i
      f.second:SetText("") -- the pot and the minimum mean different things
      layout()
    end)
  end
  f.dayChecks = {}
  for i, days in ipairs(ns.SEASON_DAYS) do
    f.dayChecks[i] = check(c, L.SEASON_DAYS:format(days), function()
      f.days = days
      layout()
    end)
  end

  f.amountLabel = ns.Text(c, "section", 14)
  f.amount = input(f, c, 110, 12)
  f.amount:SetScript("OnTextChanged", refresh)

  f.secondLabel = ns.Text(c, "section", 14)
  f.note = input(f, c, 280, 80) -- 80 = the code's note limit (Compendium 02)
  f.second = input(f, c, 110, 12) -- the pot, or a prize pool's minimum kills
  f.second:SetScript("OnTextChanged", refresh)
  local function nextBox() return f.second:IsShown() and f.second or f.note:IsShown() and f.note or f.amount end
  f.amount:SetScript("OnTabPressed", function() nextBox():SetFocus() end)
  f.note:SetScript("OnTabPressed", function() f.amount:SetFocus() end)
  f.second:SetScript("OnTabPressed", function() f.amount:SetFocus() end)

  f.limits = ns.Text(c, "muted", 13)
  f.error = c:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  f.error:SetTextColor(ns.COLORS.error[1], ns.COLORS.error[2], ns.COLORS.error[3])
  f.hint = ns.Text(c, "muted", 13)
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
  -- The target's name takes their class colour; their guild is in guild green.
  local r, g, b = ns.ClassColor(snap.classID)
  local text = ns.Describe(snap)
  local byte = function(v) return math.floor(v * 255 + 0.5) end
  if r and text:sub(1, #snap.name) == snap.name then
    text = ("|cff%02x%02x%02x%s|r%s"):format(byte(r), byte(g), byte(b), snap.name, text:sub(#snap.name + 1))
  end
  if snap.guild and snap.guild ~= "" then
    text = ("%s\n|cff%02x%02x%02x<%s>|r"):format(text, byte(GUILD_GREEN[1]), byte(GUILD_GREEN[2]), byte(GUILD_GREEN[3]), snap.guild)
  end
  frame.target:SetText(text)
  frame.limits:SetText(L.LIMITS:format(ns.FormatGold(min), ns.FormatGold(max)))
  frame.amount:SetText(amount or "")
  frame.note:SetText(note or "")
  frame.second:SetText("")

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
