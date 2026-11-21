-- Guild banners (spec 5.7, 5.8): a strip near the top of the screen in the window style,
-- shown for a few seconds with the logo. Several banners queue up instead of overlapping.
local _, ns = ...

local SHOW = 7      -- seconds on screen
local FADE = 0.6
local frame
local queue = {}

local function build()
  local f = CreateFrame("Frame", "BountyLineBanner", UIParent, "BackdropTemplate")
  f:SetSize(620, 64)
  f:SetPoint("TOP", 0, -120)
  f:SetFrameStrata("HIGH")
  f:SetBackdrop({
    bgFile = "Interface\\AddOns\\BountyLine\\Media\\window-bg",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    edgeSize = 24,
    insets = { left = 7, right = 7, top = 7, bottom = 7 },
  })
  f:EnableMouse(false)

  local icon = f:CreateTexture(nil, "ARTWORK")
  icon:SetSize(40, 40)
  icon:SetPoint("LEFT", 14, 0)
  icon:SetTexture("Interface\\AddOns\\BountyLine\\Media\\logo")

  f.text = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  f.text:SetPoint("LEFT", icon, "RIGHT", 12, 0)
  f.text:SetPoint("RIGHT", -16, 0)
  f.text:SetJustifyH("LEFT")
  f.text:SetTextColor(1, 0.82, 0.25)

  local anim = f:CreateAnimationGroup()
  local out = anim:CreateAnimation("Alpha")
  out:SetFromAlpha(1)
  out:SetToAlpha(0)
  out:SetDuration(FADE)
  out:SetStartDelay(SHOW)
  anim:SetScript("OnFinished", function()
    f:Hide()
    if #queue > 0 then ns.Banner(table.remove(queue, 1)) end
  end)
  f.anim = anim
  f:Hide()
  return f
end

function ns.Banner(text)
  local settings = BountyLineDB.settings
  if settings.banners == false then return end
  frame = frame or build()
  if frame:IsShown() then
    queue[#queue + 1] = text
    return
  end
  frame.text:SetText(text)
  frame:SetAlpha(1)
  frame:Show()
  frame.anim:Play()
  PlaySound(SOUNDKIT.RAID_WARNING)
end
