-- After a kill in combat: "BOUNTY KILLED" flashes on screen for 3 seconds, then a small
-- square with the logo sits there shimmering until you click it (once the fight is over) to
-- open the kill code. Nothing here takes the keyboard. Drag the square to move it.
local _, ns = ...
local L = ns.L

local LOGO = "Interface\\AddOns\\BountyLine\\Media\\logo"
local WHITE = "Interface\\Buttons\\WHITE8x8"
local FLASH_SECONDS = 3
local SIZE = 56
local flash, box

local function buildFlash()
  local f = CreateFrame("Frame", nil, UIParent)
  f:SetSize(600, 60)
  f:SetPoint("CENTER", 0, 180)
  f:SetFrameStrata("HIGH")
  f.text = f:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
  local font = f.text:GetFont()
  f.text:SetFont(font, 40, "THICKOUTLINE")
  f.text:SetPoint("CENTER")
  f.text:SetTextColor(1, 0.15, 0.1)
  f.text:SetText(L.KILL_FLASH)
  f.fade = f:CreateAnimationGroup()
  local out = f.fade:CreateAnimation("Alpha")
  out:SetFromAlpha(1)
  out:SetToAlpha(0)
  out:SetStartDelay(FLASH_SECONDS - 0.6)
  out:SetDuration(0.6)
  f.fade:SetScript("OnFinished", function() f:Hide() end)
  f:Hide()
  return f
end

local function buildBox()
  local b = CreateFrame("Button", "BountyLineKillToast", UIParent, "BackdropTemplate")
  b:SetSize(SIZE, SIZE)
  b:SetPoint("CENTER", 0, -150)
  b:SetFrameStrata("HIGH")
  b:SetClampedToScreen(true)
  b:SetMovable(true)
  b:RegisterForDrag("LeftButton")
  b:RegisterForClicks("AnyUp")
  b:SetScript("OnDragStart", b.StartMoving)
  b:SetScript("OnDragStop", b.StopMovingOrSizing)
  b:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 2 })
  b:SetBackdropColor(0.05, 0.03, 0.02, 0.95)
  b:SetBackdropBorderColor(0.9, 0.06, 0.04, 1)

  local logo = b:CreateTexture(nil, "ARTWORK")
  logo:SetPoint("TOPLEFT", 4, -4)
  logo:SetPoint("BOTTOMRIGHT", -4, 4)
  logo:SetTexture(LOGO)

  -- Shimmer: a soft bright band sweeping across the logo, clipped to the square.
  local clip = CreateFrame("Frame", nil, b)
  clip:SetPoint("TOPLEFT", 2, -2)
  clip:SetPoint("BOTTOMRIGHT", -2, 2)
  clip:SetClipsChildren(true)
  local band = clip:CreateTexture(nil, "OVERLAY")
  band:SetTexture(WHITE)
  band:SetBlendMode("ADD")
  band:SetVertexColor(1, 0.9, 0.6, 0.35)
  band:SetSize(14, SIZE * 2)
  band:SetPoint("CENTER", clip, "LEFT", -20, 0)
  band:SetRotation(math.rad(20))
  b.shimmer = band:CreateAnimationGroup()
  b.shimmer:SetLooping("REPEAT")
  local sweep = b.shimmer:CreateAnimation("Translation")
  sweep:SetOffset(SIZE + 40, 0)
  sweep:SetDuration(1.1)
  sweep:SetSmoothing("IN_OUT")
  local rest = b.shimmer:CreateAnimation("Translation")
  rest:SetOffset(0, 0)
  rest:SetDuration(1.4)
  rest:SetOrder(2)

  b.count = b:CreateFontString(nil, "OVERLAY", "NumberFontNormal")
  b.count:SetPoint("BOTTOMRIGHT", -4, 4)

  b:SetScript("OnClick", function() ns.OpenDeferredKill() end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:SetText(L.KILL_TOAST_TITLE, 1, 0.82, 0.25)
    GameTooltip:AddLine(L.KILL_TOAST_TIP, 0.93, 0.91, 0.86, true)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  b:Hide()
  return b
end

-- waiting: how many kill codes are waiting to be opened.
function ns.ShowKillToast(waiting)
  flash = flash or buildFlash()
  box = box or buildBox()
  flash:SetAlpha(1)
  flash:Show()
  flash.fade:Stop()
  flash.fade:Play()
  ns.Sound(SOUNDKIT.RAID_WARNING)
  box.count:SetText(waiting > 1 and waiting or "")
  -- The square appears as the flash ends.
  C_Timer.After(FLASH_SECONDS, function()
    if ns.DeferredKills() > 0 then
      box:Show()
      box.shimmer:Play()
    end
  end)
end

-- Called after a waiting code is opened: update the count, or put the square away.
function ns.UpdateKillToast(waiting)
  if not box then return end
  if waiting > 0 then
    box.count:SetText(waiting > 1 and waiting or "")
  else
    box.shimmer:Stop()
    box:Hide()
  end
end
