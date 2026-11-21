-- "Post this in the Discord Bounty Line chat" popup with a read-only code box and a copy
-- button (spec 5.4, 5.7b). Addons can't write to the clipboard: the button selects the code
-- and the player presses Ctrl+C. Shared by bounty, link and (Phase 4) kill codes.
local _, ns = ...
local L = ns.L

local WIDTH = 578
local frame

local function selectAll(selected)
  frame.box:SetFocus()
  frame.box:HighlightText()
  frame.hint:SetText(selected and L.SELECTED or L.COPY_HINT)
end

local function build()
  local f = ns.CreateWindow("BountyLineCodePopup", WIDTH, 320, L.ADDON)
  local c = f.content

  f.heading = ns.Text(c, "heading")
  f.heading:SetPoint("TOPLEFT", 16, -12)

  f.subtitle = ns.Text(c, "body", 14)
  f.subtitle:SetPoint("TOPLEFT", f.heading, "BOTTOMLEFT", 0, -6)
  f.subtitle:SetPoint("RIGHT", -16, 0)

  f.instructions = ns.Text(c, "section", 13)
  f.instructions:SetPoint("TOPLEFT", 28, -72)
  f.instructions:SetPoint("RIGHT", -16, 0)

  local box = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
  -- Fills the panel width, leaving room for the copy button on its right.
  box:SetHeight(26)
  box:SetPoint("TOPLEFT", f.instructions, "BOTTOMLEFT", -4, -10)
  box:SetPoint("TOPRIGHT", f.instructions, "BOTTOMRIGHT", -40, -10)
  box:SetAutoFocus(false)
  box:SetMaxLetters(0)
  box:SetFontObject("ChatFontNormal")
  -- Read-only: typing restores the code, clicking re-selects all of it.
  box:SetScript("OnTextChanged", function(self, userInput)
    if userInput then
      self:SetText(f.code)
      self:HighlightText()
    end
  end)
  box:SetScript("OnMouseUp", function() selectAll(true) end)
  box:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  box:SetScript("OnEscapePressed", function() f:Hide() end)
  box:SetScript("OnEnterPressed", function() selectAll(true) end)
  f.box = box

  -- The box's own text is invisible (it must hold the real line for Ctrl+C); a tidy label
  -- sits on top instead, like the spoiler bar in Discord. The selection highlight still shows.
  box:SetTextColor(1, 1, 1, 0)
  f.label = box:CreateFontString(nil, "OVERLAY", "ChatFontNormal")
  f.label:SetPoint("LEFT", 2, 0)
  f.label:SetPoint("RIGHT", -4, 0)
  f.label:SetJustifyH("LEFT")
  f.label:SetWordWrap(false)

  local copy = CreateFrame("Button", nil, c)
  copy:SetSize(26, 26)
  copy:SetPoint("LEFT", box, "RIGHT", 8, 0)
  copy:SetNormalTexture("Interface\\Buttons\\UI-GuildButton-PublicNote-Up")
  copy:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
  copy:SetScript("OnClick", function()
    selectAll(true)
    PlaySound(SOUNDKIT.IG_MAINMENU_OPTION_CHECKBOX_ON)
  end)
  copy:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:SetText(L.COPY_TIP)
    GameTooltip:Show()
  end)
  copy:SetScript("OnLeave", function() GameTooltip:Hide() end)

  -- The one step the addon can't do for you: big, red and pulsing so nobody misses it.
  f.hint = ns.Text(c, "body", 20)
  local font = f.hint:GetFont()
  f.hint:SetFont(font, 20, "OUTLINE")
  f.hint:SetTextColor(1, 0.18, 0.12)
  f.hint:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -12)
  local pulse = f.hint:CreateAnimationGroup()
  pulse:SetLooping("BOUNCE")
  local fade = pulse:CreateAnimation("Alpha")
  fade:SetFromAlpha(1)
  fade:SetToAlpha(0.35)
  fade:SetDuration(0.7)
  fade:SetSmoothing("IN_OUT")
  pulse:Play() -- new frames start shown: OnShow won't fire for the first open
  f:HookScript("OnShow", function() pulse:Play() end)
  f:HookScript("OnHide", function() pulse:Stop() end)

  f.note = ns.Text(c, "muted", 13)
  f.note:SetPoint("TOPLEFT", f.hint, "BOTTOMLEFT", 0, -8)
  f.note:SetPoint("RIGHT", -16, 0)

  local close = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  close:SetSize(100, 24)
  close:SetPoint("BOTTOMRIGHT", -14, 12)
  close:SetText(L.CLOSE)
  close:SetScript("OnClick", function() f:Hide() end)

  return f
end

-- opts: { title, subtitle, instructions, code, line?, note? }. `line` = { kind, name, detail }:
-- the box holds ns.CopyLine(...) around the code, built fresh on every show so /bl last never
-- shows a line saved by an older version. Without `line` the box holds the bare code.
function ns.ShowCode(opts)
  frame = frame or build()
  BountyLineCharDB.lastPopup = opts
  local line = opts.line
  frame.code = line and ns.CopyLine(line[1], line[2], line[3], opts.code) or opts.code
  frame.heading:SetText(opts.title)
  frame.subtitle:SetText(opts.subtitle or "")
  frame.instructions:SetText(opts.instructions or "")
  frame.note:SetText(opts.note or "")
  frame.box:SetText(frame.code)
  frame.box:SetCursorPosition(0)
  frame.label:SetText(ns.DisplayLine(line) .. L.CODE_HIDDEN)
  frame:Show()
  -- Open already selected, so the fastest path is just Ctrl+C.
  selectAll(true)
end
