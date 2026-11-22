-- Proof stamp (spec 9.2): shown for the screenshot, full width at screen center. Built for
-- the AI stamp reader in Phase 6: plain font, white on a dark band, the full kill code.
-- Under the band, on the left, the same code as a QR code: the Bounty Board reads it out of
-- the screenshot, so the screenshot alone is a complete kill claim.
local _, ns = ...
local L = ns.L

local FONT = "Fonts\\ARIALN.TTF"
local frame

local function line(parent, size, y, r, g, b)
  local fs = parent:CreateFontString(nil, "OVERLAY")
  fs:SetFont(FONT, size, "")
  fs:SetPoint("TOP", 0, y)
  fs:SetTextColor(r or 1, g or 1, b or 1)
  return fs
end

-- ---------------------------------------------------------------- QR code

local QR_BOX = 200  -- the white box's side, in UI units (shrunk to whole screen pixels per module)
local QR_QUIET = 4  -- white modules around the code; readers need them
local qr

-- Black runs of each row as { x, y, length } (1-based modules): far fewer textures than one
-- per module. Returns the runs and the code's size in modules, or nil if it can't be encoded.
function ns.QRRuns(code)
  if not (ns.QR and type(code) == "string") then return nil end
  local ok, tab = ns.QR.qrcode(code, 2) -- 2 = medium error correction
  if not ok then return nil end
  local n, runs = #tab, {}
  for y = 1, n do
    local x = 1
    while x <= n do
      if tab[x][y] > 0 then
        local from = x
        while x <= n and tab[x][y] > 0 do x = x + 1 end
        runs[#runs + 1] = { from, y, x - from }
      else
        x = x + 1
      end
    end
  end
  return runs, n
end

-- A white square that ns.DrawQR fills. The caller places it.
function ns.NewQR(parent)
  local f = CreateFrame("Frame", nil, parent)
  local white = f:CreateTexture(nil, "BACKGROUND")
  white:SetAllPoints()
  white:SetColorTexture(1, 1, 1, 1)
  f.pool = {}
  f:Hide()
  return f
end

-- Draws the code into a frame from ns.NewQR and shows it. Returns false (and hides the frame)
-- if the code can't be drawn. Also used by the relay (Relay.lua).
function ns.DrawQR(box, code)
  local runs, n = ns.QRRuns(code)
  if not runs then
    box:Hide()
    return false
  end
  -- A whole number of screen pixels per module, so every module is the same size.
  local _, screenHeight = GetPhysicalScreenSize()
  local unitPx = (screenHeight or 768) / 768 * box:GetEffectiveScale()
  local m = math.max(3, math.floor(QR_BOX * unitPx / (n + QR_QUIET * 2))) / unitPx
  box:SetSize(m * (n + QR_QUIET * 2), m * (n + QR_QUIET * 2))
  for i, run in ipairs(runs) do
    local t = box.pool[i]
    if not t then
      t = box:CreateTexture(nil, "ARTWORK")
      t:SetColorTexture(0, 0, 0, 1)
      box.pool[i] = t
    end
    t:ClearAllPoints()
    t:SetPoint("TOPLEFT", m * (QR_QUIET + run[1] - 1), -m * (QR_QUIET + run[2] - 1))
    t:SetSize(m * run[3], m)
    t:Show()
  end
  for i = #runs + 1, #box.pool do box.pool[i]:Hide() end
  box:Show()
  return true
end

local function drawQR(parent, code)
  if not qr then
    qr = ns.NewQR(parent)
    qr:SetPoint("TOPLEFT", parent, "BOTTOMLEFT", 24, -12)
  end
  ns.DrawQR(qr, code)
end

local function build()
  local f = CreateFrame("Frame", "BountyLineStamp", UIParent)
  f:SetFrameStrata("FULLSCREEN_DIALOG")
  f:SetPoint("LEFT", 0, 0)
  f:SetPoint("RIGHT", 0, 0)
  f:SetHeight(170)
  local band = f:CreateTexture(nil, "BACKGROUND")
  band:SetAllPoints()
  band:SetColorTexture(0, 0, 0, 0.88)
  for _, edge in ipairs({ "TOP", "BOTTOM" }) do
    local bar = f:CreateTexture(nil, "BORDER")
    bar:SetColorTexture(0.85, 0.08, 0.06, 1)
    bar:SetHeight(4)
    bar:SetPoint(edge .. "LEFT")
    bar:SetPoint(edge .. "RIGHT")
  end
  f.title = line(f, 30, -16, 1, 0.82, 0.25)
  f.target = line(f, 26, -54)
  f.place = line(f, 22, -88)
  f.code = line(f, 22, -122)
  f:Hide()
  return f
end

function ns.ShowStamp(k)
  frame = frame or build()
  frame.title:SetText(k.practice and L.STAMP_PRACTICE or L.STAMP_TITLE)
  frame.target:SetText(ns.KillLine(k))
  local zone = ns.ZoneName() or ""
  frame.place:SetText(("%s%s%s"):format(zone, zone ~= "" and " · " or "", date("%Y-%m-%d %H:%M:%S", k.killedAt)))
  frame.code:SetText(k.code)
  drawQR(frame, k.code)
  frame:Show()
end

function ns.HideStamp()
  if frame then frame:Hide() end
end
