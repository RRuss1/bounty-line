-- Relay (spec 5.10): works with the optional relay program an officer runs on their PC.
--
--   Discord -> game  The program writes the newest Bounty Pack into its own addon folder
--                    (BountyLine_Relay, global BountyLine_RelayPack). It is loaded here at
--                    login or /reload and shared with the guild: nobody types /bl import.
--   Game -> Discord  When a guildie makes a bounty code, this client shows it as a QR code
--                    and takes a screenshot. The program reads the file and posts the bounty.
--
-- The program can't talk to a running game, so the addon decides whether it's there from a
-- time stamp the program rewrites every minute (BountyLine_RelayAlive), read at load.
local _, ns = ...
local L = ns.L

local ALIVE_WINDOW = 600 -- seconds: how fresh the program's stamp must be at login
local SHOW_SECONDS = 1.2 -- how long each QR code stays up
local active = false
local queue, busy = {}, false
local handled = {}       -- code -> true: queued here, or already picked up by another relay

function ns.RelayActive() return active end

-- Called at login. alive / packText / now are passed in so this can be tested.
function ns.RelayStart(alive, packText, now)
  local s = BountyLineDB.settings or {}
  active = false
  if s.relay == false then return end
  alive = tonumber(alive)
  active = alive ~= nil and math.abs(now - alive) <= ALIVE_WINDOW
  if type(packText) == "string" and packText ~= "" then
    local pack = ns.ReadPack(packText)
    local version, tag = ns.PackVersion()
    -- Same rules as a pack from a guildie: this board only, and only if it's newer.
    if pack and (version == 0 or pack.boardTag == tag) and pack.packVersion > version then
      local ok, added = ns.StorePack(pack)
      if ok then
        ns.RefreshMarks()
        if ns.RefreshBoard then ns.RefreshBoard() end
        ns.Print(L.RELAY_PACK:format(#pack.bounties))
        for _, b in ipairs(added or {}) do ns.Banner(L.BANNER_NEW:format(b.targetName, ns.FormatGold(b.rewardGold), ns.BoardName())) end
        -- After the guild roster settles, hand it to everyone online.
        C_Timer.After(12, ns.Comms.SharePack)
      end
    end
  end
  if active then ns.Print(L.RELAY_ON) end
end

-- ---------------------------------------------------------------- QR frames for the program

local frame

-- Shows the code as a QR code where the proof stamp puts its own (lower left, under where the
-- band would be), so the program looks in one place for both. Replaced in tests.
function ns.RelayShow(code)
  if not frame then
    frame = ns.NewQR(UIParent)
    frame:SetFrameStrata("FULLSCREEN_DIALOG")
    frame:SetPoint("TOPLEFT", UIParent, "LEFT", 24, -97)
    frame.caption = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    frame.caption:SetPoint("TOP", frame, "BOTTOM", 0, -4)
    frame.caption:SetText(L.RELAY_CAPTION)
  end
  if not ns.DrawQR(frame, code) then return false end
  -- Give it a frame to draw, then take the shot.
  C_Timer.After(0.2, function() pcall(Screenshot) end)
  return true
end

function ns.RelayHide()
  if frame then frame:Hide() end
end

local function pump()
  if busy or #queue == 0 then return end
  -- A kill's proof stamp comes first: its screenshot must not carry a second QR code.
  if ns.KillBusy and ns.KillBusy() then
    C_Timer.After(2, pump)
    return
  end
  busy = true
  ns.RelayShow(table.remove(queue, 1))
  C_Timer.After(SHOW_SECONDS, function()
    ns.RelayHide()
    busy = false
    C_Timer.After(0.5, pump)
  end)
end

-- Queues a bounty code for the program. Returns true if this client took it.
function ns.RelayQueue(code)
  if not active or handled[code] then return false end
  handled[code] = true
  queue[#queue + 1] = code
  pump()
  return true
end

-- Another relay officer picked this code up: leave it to them.
function ns.RelayHandled(code)
  handled[code] = true
  for i = #queue, 1, -1 do
    if queue[i] == code then table.remove(queue, i) end
  end
end
