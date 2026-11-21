-- "Post this in the Discord Bounty Line chat" popup with a read-only code box and a copy
-- button (spec 5.4, 5.7b). Addons can't write to the clipboard: the button selects the code
-- and the player presses Ctrl+C. Shared by bounty, link and (Phase 4) kill codes.
local _, ns = ...
local L = ns.L

local WIDTH = 520
local frame

local function selectAll(hint)
  frame.box:SetFocus()
  frame.box:HighlightText()
  frame.hint:SetText(hint and L.SELECTED or L.COPY_HINT)
end

local function build()
  local f = CreateFrame("Frame", "BountyLineCodePopup", UIParent, "BackdropTemplate")
  f:SetSize(WIDTH, 190)
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
  tinsert(UISpecialFrames, "BountyLineCodePopup") -- Escape closes it

  local icon = f:CreateTexture(nil, "ARTWORK")
  icon:SetSize(28, 28)
  icon:SetPoint("TOPLEFT", 22, -20)
  icon:SetTexture("Interface\\TargetingFrame\\UI-RaidTargetingIcon_8")

  f.title = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  f.title:SetPoint("LEFT", icon, "RIGHT", 8, 0)

  f.subtitle = f:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  f.subtitle:SetPoint("TOPLEFT", icon, "BOTTOMLEFT", 0, -8)
  f.subtitle:SetPoint("RIGHT", -22, 0)
  f.subtitle:SetJustifyH("LEFT")

  f.instructions = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  f.instructions:SetPoint("TOPLEFT", f.subtitle, "BOTTOMLEFT", 0, -10)
  f.instructions:SetPoint("RIGHT", -22, 0)
  f.instructions:SetJustifyH("LEFT")

  local box = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  box:SetSize(WIDTH - 90, 24)
  box:SetPoint("TOPLEFT", f.instructions, "BOTTOMLEFT", 6, -8)
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

  local copy = CreateFrame("Button", nil, f)
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

  f.hint = f:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  f.hint:SetPoint("TOPLEFT", box, "BOTTOMLEFT", -6, -10)

  local close = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  close:SetSize(90, 22)
  close:SetPoint("BOTTOMRIGHT", -20, 18)
  close:SetText(L.CLOSE)
  close:SetScript("OnClick", function() f:Hide() end)

  return f
end

-- opts: { title, subtitle, instructions, code }. Remembered for /bl last.
function ns.ShowCode(opts)
  frame = frame or build()
  BountyLineCharDB.lastPopup = opts
  frame.code = opts.code
  frame.title:SetText(opts.title)
  frame.subtitle:SetText(opts.subtitle or "")
  frame.instructions:SetText(opts.instructions or "")
  frame.box:SetText(opts.code)
  frame.box:SetCursorPosition(0)
  frame:Show()
  -- Open already selected, so the fastest path is just Ctrl+C.
  selectAll(true)
end
