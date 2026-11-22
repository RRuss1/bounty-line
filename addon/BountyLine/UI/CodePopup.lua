-- "Post this in the Discord Bounty Line chat" popup with a read-only code box and a copy
-- button (spec 5.4, 5.7b). Addons can't write to the clipboard: the button selects the code
-- and the player presses Ctrl+C. Shared by bounty, link and (Phase 4) kill codes.
local _, ns = ...
local L = ns.L

local WIDTH = 578
local HEIGHT, HEIGHT_WITH_FOLDER = 320, 400
-- Where the game saves screenshots, in a form Windows expands by itself: pasted into the
-- "File name" box of Discord's upload window, it jumps straight to the folder. The addon
-- can't see where the game is installed, so this is the default location.
local SCREENSHOT_FOLDER = "%ProgramFiles(x86)%\\World of Warcraft\\_forever_\\Screenshots"
local frame

local function selectAll(selected)
  -- Never take the keyboard during combat: WASD would go into the box.
  if InCombatLockdown() and not frame.box:HasFocus() then
    frame.hint:SetText(L.COPY_HINT)
    return
  end
  frame.box:SetFocus()
  frame.box:HighlightText()
  frame.hint:SetText(selected and L.SELECTED or L.COPY_HINT)
end

local function build()
  local f = ns.CreateWindow("BountyLineCodePopup", WIDTH, HEIGHT, L.ADDON)
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

  -- Kill codes: the screenshot is what gets posted, so the way to its folder is here too.
  f.folderLabel = ns.Text(c, "body", 13)
  f.folderLabel:SetPoint("TOPLEFT", f.note, "BOTTOMLEFT", 0, -12)
  f.folderLabel:SetPoint("RIGHT", -16, 0)
  f.folderLabel:SetText(L.FOLDER_LABEL)
  local folder = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
  folder:SetHeight(26)
  folder:SetPoint("TOPLEFT", f.folderLabel, "BOTTOMLEFT", 2, -6)
  folder:SetPoint("RIGHT", -54, 0)
  folder:SetAutoFocus(false)
  folder:SetMaxLetters(0)
  folder:SetFontObject("ChatFontNormal")
  local function selectFolder()
    if InCombatLockdown() and not folder:HasFocus() then return end -- never take the keyboard mid-fight
    folder:SetFocus()
    folder:HighlightText()
    f.hint:SetText(L.SELECTED)
  end
  folder:SetScript("OnTextChanged", function(self, userInput)
    if userInput then
      self:SetText(SCREENSHOT_FOLDER)
      self:HighlightText()
    end
  end)
  folder:SetScript("OnMouseUp", selectFolder)
  folder:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
  folder:SetScript("OnEscapePressed", function() f:Hide() end)
  f.folder = folder

  local close = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  close:SetSize(100, 24)
  close:SetPoint("BOTTOMRIGHT", -14, 12)
  close:SetText(L.CLOSE)
  close:SetScript("OnClick", function() f:Hide() end)

  return f
end

-- A relay officer picked up the code in the open popup (or the last one shown): say so, in
-- the popup and in chat, so the player knows there's nothing to paste.
function ns.CodeRelayed(code, who)
  local last = BountyLineCharDB.lastPopup
  if not last or last.code ~= code or last.relayedBy then return end
  last.relayedBy = who
  local text = L.RELAYED:format(who)
  ns.Print(text)
  if frame and frame:IsShown() then frame.note:SetText(text) end
end

-- opts: { title, subtitle, instructions, code, line?, note?, folder? }. `folder` adds the
-- Screenshots folder row (kill codes). `line` = { kind, name, detail }:
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
  frame.note:SetText(opts.relayedBy and L.RELAYED:format(opts.relayedBy) or opts.note or "")
  frame.box:SetText(frame.code)
  frame.box:SetCursorPosition(0)
  frame.label:SetText(ns.DisplayLine(line) .. L.CODE_HIDDEN)
  frame:SetHeight(opts.folder and HEIGHT_WITH_FOLDER or HEIGHT)
  frame.folderLabel:SetShown(opts.folder and true or false)
  frame.folder:SetShown(opts.folder and true or false)
  frame.folder:SetText(SCREENSHOT_FOLDER)
  frame.folder:SetCursorPosition(0)
  frame:Show()
  -- Open already selected, so the fastest path is just Ctrl+C.
  selectAll(true)
end
