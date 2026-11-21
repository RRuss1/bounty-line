-- "Post this in the Discord Bounty Line chat" popup with a read-only code box and a copy
-- button (spec 5.4, 5.7b). Addons can't write to the clipboard: the button selects the code
-- and the player presses Ctrl+C. Shared by bounty, link and (Phase 4) kill codes.
local _, ns = ...
local L = ns.L

local WIDTH = 540
local frame

local function selectAll(selected)
  frame.box:SetFocus()
  frame.box:HighlightText()
  frame.hint:SetText(selected and L.SELECTED or L.COPY_HINT)
end

local function build()
  local f = ns.CreateWindow("BountyLineCodePopup", WIDTH, 210, L.ADDON)
  local c = f.content

  f.heading = ns.Text(c, "GameFontNormalHuge")
  f.heading:SetPoint("TOPLEFT", 58, -14)

  f.subtitle = ns.Text(c, "GameFontHighlight", 14)
  f.subtitle:SetPoint("TOPLEFT", f.heading, "BOTTOMLEFT", 0, -6)
  f.subtitle:SetPoint("RIGHT", -16, 0)

  f.instructions = ns.Text(c, "GameFontHighlight", 13)
  f.instructions:SetPoint("TOPLEFT", 18, -74)
  f.instructions:SetPoint("RIGHT", -16, 0)

  local box = CreateFrame("EditBox", nil, c, "InputBoxTemplate")
  box:SetSize(WIDTH - 90, 26)
  box:SetPoint("TOPLEFT", f.instructions, "BOTTOMLEFT", 8, -8)
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

  f.hint = ns.Text(c, "GameFontHighlight", 13)
  f.hint:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -10)

  local close = CreateFrame("Button", nil, c, "UIPanelButtonTemplate")
  close:SetSize(100, 24)
  close:SetPoint("BOTTOMRIGHT", -14, 12)
  close:SetText(L.CLOSE)
  close:SetScript("OnClick", function() f:Hide() end)

  return f
end

-- opts: { title, subtitle, instructions, code }. Remembered for /bl last.
function ns.ShowCode(opts)
  frame = frame or build()
  BountyLineCharDB.lastPopup = opts
  frame.code = opts.code
  frame.heading:SetText(opts.title)
  frame.subtitle:SetText(opts.subtitle or "")
  frame.instructions:SetText(opts.instructions or "")
  frame.box:SetText(opts.code)
  frame.box:SetCursorPosition(0)
  frame:Show()
  -- Open already selected, so the fastest path is just Ctrl+C.
  selectAll(true)
end
