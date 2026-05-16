//811 cambiotiempo
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js')
const { Redis } = require("@upstash/redis")




const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
})

const TOKEN = process.env.TOKEN

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
})



//detecta onlineppm
const GROUP_CONFIG = {
  Trainer: {
    label: "Trainer"
  },
  Gym_Leader: {
    label: "Gym Leader"
  },
  Elite_Four: {
    label: "Elite Four"
  }
}

function onlineKey(group) {
  return `online:${group}`
}

function usersKey(group) {
  return `users:${group}`
}

function vipKey(group) {
  return `vip:${group}`
}

function schedulesKey() {
  return "daily_schedules"
}

function activeRolesKey() {
  return "active_roles"
}

function historyKey() {
  return "ppm_history"
}

function safeJsonParse(value, fallback = {}) {
  try {
    if (!value) return fallback
    if (typeof value === "object") return value
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
function uniqueList(arr) {
  return [...new Set(
    arr
      .map(x => String(x || "").trim())
      .filter(Boolean)
  )]
}

function buildUserData(oldData, interaction, updates = {}) {
  const discordName =
    interaction.member?.displayName ||
    interaction.user?.username ||
    "Unknown"

  const oldAliases = Array.isArray(oldData.aliases) ? oldData.aliases : []

  const name = oldData.name || discordName

  const heartbeatName =
    oldData.heartbeatName ||
    oldData.name ||
    discordName

  const aliases = uniqueList([
    ...oldAliases,
    oldData.name,
    oldData.heartbeatName,
    discordName,
    name,
    heartbeatName
  ])

  return {
    ...oldData,
    name,
    heartbeatName,
    aliases,
    ...updates
  }
}

function isValidId(id) {
  return /^\d{16}$/.test(String(id || "").trim())
}

function normalizeRedisIds(ids) {
  if (!Array.isArray(ids)) return []

  return ids
    .map(id => String(id).trim())
    .filter(id => /^\d{16}$/.test(id))
}

function normalizeGroupRoleName(roleName) {
  const map = {
    "Trainer": "Trainer",
    "Gym_Leader": "Gym_Leader",
    "Gym Leader": "Gym_Leader",
    "Elite_Four": "Elite_Four",
    "Elite Four": "Elite_Four"
  }

  return map[roleName] || null
}

function getMemberGroups(member) {
  return member.roles.cache
    .map(role => normalizeGroupRoleName(role.name))
    .filter(Boolean)
    .filter((group, index, arr) => arr.indexOf(group) === index)
}

function normalizeSelectableRoleName(roleName) {
  const normalGroup = normalizeGroupRoleName(roleName)

  if (normalGroup) return normalGroup

  if (roleName === "Rival_Duo" || roleName === "Rival Duo") {
    return "Rival_Duo"
  }

  return null
}

function getMemberSelectableRoles(member) {
  return member.roles.cache
    .map(role => normalizeSelectableRoleName(role.name))
    .filter(Boolean)
    .filter((group, index, arr) => arr.indexOf(group) === index)
}

function getSelectableRoleLabel(group) {
  if (group === "Rival_Duo") return "Rival Duo"
  return getGroupLabel(group)
}

function getGroupLabel(group) {
  return GROUP_CONFIG[group]?.label || group
}

const CHANNEL_GROUP_MAP = {
  "1486277594629275770": "Elite_Four",  // canal elite
  "1487362022864588902": "Trainer",     // canal trainer
  "1484015417411244082": "Gym_Leader"   // canal gym
}


async function getUserGroup(interaction) {
  const activeRoles = await getActiveRoles()
  const memberGroups = getMemberGroups(interaction.member)

  if (!memberGroups.length) return null

  const savedRole = activeRoles[interaction.user.id]

  if (savedRole && memberGroups.includes(savedRole)) {
    return savedRole
  }

  return memberGroups[0]
}
async function isActiveRivalDuo(interaction) {
  const activeRoles = await getActiveRoles()
  const selected = activeRoles[interaction.user.id]

  const hasRivalDuoRole = interaction.member.roles.cache.some(role =>
    role.name === "Rival_Duo" || role.name === "Rival Duo"
  )

  return hasRivalDuoRole && selected === "Rival_Duo"
}

async function getOnlineIDs(group) {
  if (!GROUP_CONFIG[group]) return []

  try {
    const ids = await redis.smembers(onlineKey(group))
    return normalizeRedisIds(ids)
  } catch (err) {
    console.error(`getOnlineIDs Redis error for ${group}:`, err)
    return []
  }
}



//
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function buildUserLabel(user, id) {
  if (!user) return `Unknown`;
  if (user.main_id === id) return `${user.name} (Main)`;
  if (user.sec_id === id) return `${user.name} (Sec)`;
  return `${user.name}`;
}

async function getOnlineUsersByGroup(group) {
  if (!GROUP_CONFIG[group]) return []

  const onlineIds = await getOnlineIDs(group)
  if (!onlineIds.length) return []

  const users = await getUsers(group)
  const results = []

  for (const id of onlineIds) {
    let foundUser = null

    for (const uid in users) {
      const u = users[uid]
      if (u.main_id === id || u.sec_id === id) {
        foundUser = u
        break
      }
    }

    results.push({
      id,
      label: buildUserLabel(foundUser, id),
      user: foundUser
    })
  }

  return results
}

// ================= DAILY SCHEDULE SYSTEM =================

async function loadSchedules() {
  try {
    const data = await redis.get(schedulesKey())
    return safeJsonParse(data, {})
  } catch (err) {
    console.error("Error loading schedules from Redis:", err)
    return {}
  }
}

async function saveSchedules(data) {
  try {
    await redis.set(schedulesKey(), JSON.stringify(data || {}))
  } catch (err) {
    console.error("Error saving schedules to Redis:", err)
  }
}

function startDailyScheduler() {
  setInterval(async () => {
    const schedules = await loadSchedules();
    const now = new Date();

    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const todayUTC = now.toISOString().slice(0, 10);

    for (const userId in schedules) {
      const data = schedules[userId];
      if (!data.group || !data.main_id) continue;

      // ONLINE
      if (
        data.online_hour === utcHour &&
        data.online_minute === utcMinute &&
        data.last_online !== todayUTC
      ) {
        const ok = await setOnlineStatus("online", data.main_id, data.group);

        if (ok) {
          data.last_online = todayUTC;
          console.log("🟢 Daily ONLINE ejecutado:", data.main_id);
        }
      }

      // OFFLINE
      if (
        data.offline_hour === utcHour &&
        data.offline_minute === utcMinute &&
        data.last_offline !== todayUTC
      ) {
        const ok = await setOnlineStatus("offline", data.main_id, data.group);

        if (ok) {
          data.last_offline = todayUTC;
          console.log("🔴 Daily OFFLINE ejecutado:", data.main_id);
        }
      }
    }

    await saveSchedules(schedules);
  }, 60 * 1000);
}


async function loadHistory() {
  try {
    const data = await redis.get(historyKey())
    return safeJsonParse(data, [])
  } catch (err) {
    console.error("Error loading history from Redis:", err)
    return []
  }
}

async function saveHistory(data) {
  try {
    await redis.set(historyKey(), JSON.stringify(data || []))
  } catch (err) {
    console.error("Error saving history to Redis:", err)
  }
}
//let onlineUsers = {}
async function setOnlineStatus(action, id, group) {
  try {
    id = String(id || "").trim()

    if (!["online", "offline"].includes(action)) {
      console.error("Invalid action:", action)
      return false
    }

    if (!isValidId(id)) {
      console.error("Invalid ID:", id)
      return false
    }

    if (!GROUP_CONFIG[group]) {
      console.error("Invalid group:", group)
      return false
    }

    if (action === "online") {
      await redis.sadd(onlineKey(group), id)
    }

    if (action === "offline") {
      await redis.srem(onlineKey(group), id)
    }

    return true
  } catch (err) {
    console.error(`setOnlineStatus ${action} error:`, err)
    return false
  }
}


async function getUsers(group) {
  try {
    if (!GROUP_CONFIG[group]) {
      console.error("getUsers invalid group:", group)
      return {}
    }

    const data = await redis.hgetall(usersKey(group))

    if (!data || typeof data !== "object") {
      return {}
    }

    const users = {}

    for (const uid in data) {
      users[uid] = safeJsonParse(data[uid], {})
    }

    return users
  } catch (err) {
    console.error(`Error loading users from Redis for ${group}:`, err)
    return {}
  }
}
async function getActiveRoles() {
  try {
    const data = await redis.hgetall(activeRolesKey())

    if (!data || typeof data !== "object") {
      return {}
    }

    return data
  } catch (err) {
    console.error("Error loading active roles from Redis:", err)
    return {}
  }
}

async function saveActiveRoles(data) {
  try {
    if (!data || typeof data !== "object") return

    await redis.del(activeRolesKey())

    if (Object.keys(data).length > 0) {
      await redis.hset(activeRolesKey(), data)
    }
  } catch (err) {
    console.error("Error saving active roles to Redis:", err)
  }
}

async function saveUsers(users, group) {
  try {
    if (!GROUP_CONFIG[group]) {
      console.error("saveUsers invalid group:", group)
      return false
    }

    const key = usersKey(group)

    await redis.del(key)

    const payload = {}

    for (const uid in users) {
      payload[uid] = JSON.stringify(users[uid])
    }

    if (Object.keys(payload).length > 0) {
      await redis.hset(key, payload)
    }

    return true
  } catch (err) {
    console.error(`Error saving users to Redis for ${group}:`, err)
    return false
  }
}

//advio
async function addVipID(id, group) {
  try {
    id = String(id || "").trim()

    if (!isValidId(id)) {
      console.error("Invalid VIP ID:", id)
      return false
    }

    if (!GROUP_CONFIG[group]) {
      console.error("Invalid VIP group:", group)
      return false
    }

    await redis.sadd(vipKey(group), id)

    console.log(`✅ VIP added to Redis ${group}:`, id)
    return true
  } catch (err) {
    console.error("Error saving VIP to Redis:", err)
    return false
  }
}

// ================= RIVAL DUO SYSTEM =================

const RIVAL_DUOS_KEY = "rival_duos"
const RIVAL_DUO_BY_USER_KEY = "rival_duo_by_user"
const RIVAL_DUO_BY_GAMEID_KEY = "rival_duo_by_gameid"

function rivalDuoPendingKey(discordId) {
  return `rival_duo_pending:${discordId}`
}

function createRivalDuoId() {
  return `duo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function rivalNow() {
  return Date.now()
}

function isValidGameId(id) {
  return /^\d{16}$/.test(String(id || "").trim())
}

function parseRivalJson(value, fallback = {}) {
  try {
    if (!value) return fallback
    if (typeof value === "object") return value
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function getRivalDuoMembers(duo) {
  return Object.entries(duo?.members || {}).map(([discordId, member]) => ({
    discordId,
    ...member
  }))
}

function getRivalDuoMember(duo, discordId) {
  return duo?.members?.[String(discordId)] || null
}

function isRivalDuoFull(duo) {
  return getRivalDuoMembers(duo).length >= 2
}

function displayRivalDuoName(duo) {
  const members = getRivalDuoMembers(duo)

  if (!members.length) return "Empty Duo"

  return members
    .map(m => m.name || m.heartbeatName || "Unknown")
    .join(" & ")
}

async function loadAllRivalDuos() {
  try {
    const data = await redis.hgetall(RIVAL_DUOS_KEY)

    if (!data || typeof data !== "object") return {}

    const out = {}

    for (const duoId in data) {
      out[duoId] = parseRivalJson(data[duoId], null)
    }

    return out
  } catch (err) {
    console.error("Error loading rival duos:", err)
    return {}
  }
}

async function saveRivalDuo(duo) {
  try {
    if (!duo?.id) return false

    await redis.hset(RIVAL_DUOS_KEY, {
      [duo.id]: JSON.stringify(duo)
    })

    return true
  } catch (err) {
    console.error("Error saving rival duo:", err)
    return false
  }
}

async function getRivalDuoById(duoId) {
  try {
    const raw = await redis.hget(RIVAL_DUOS_KEY, String(duoId))
    return parseRivalJson(raw, null)
  } catch (err) {
    console.error("Error loading rival duo by id:", err)
    return null
  }
}

async function getRivalDuoByUser(discordId) {
  try {
    const raw = await redis.hget(RIVAL_DUO_BY_USER_KEY, String(discordId))

    if (!raw) return null

    const ref = parseRivalJson(raw, null)

    if (!ref?.duoId) return null

    return await getRivalDuoById(ref.duoId)
  } catch (err) {
    console.error("Error loading rival duo by user:", err)
    return null
  }
}

async function saveRivalDuoIndexes(duo) {
  try {
    for (const member of getRivalDuoMembers(duo)) {
      await redis.hset(RIVAL_DUO_BY_USER_KEY, {
        [member.discordId]: JSON.stringify({
          duoId: duo.id,
          discordId: member.discordId
        })
      })

      await redis.hset(RIVAL_DUO_BY_GAMEID_KEY, {
        [member.gameId]: JSON.stringify({
          duoId: duo.id,
          discordId: member.discordId
        })
      })
    }

    return true
  } catch (err) {
    console.error("Error saving rival duo indexes:", err)
    return false
  }
}

async function findOpenRivalDuos() {
  const duos = await loadAllRivalDuos()

  return Object.values(duos)
    .filter(Boolean)
    .filter(duo => !isRivalDuoFull(duo))
}

async function savePendingRivalDuoRegistration(discordId, data) {
  await redis.set(rivalDuoPendingKey(discordId), JSON.stringify(data), {
    ex: 10 * 60
  })
}

async function loadPendingRivalDuoRegistration(discordId) {
  const raw = await redis.get(rivalDuoPendingKey(discordId))
  return parseRivalJson(raw, null)
}

async function clearPendingRivalDuoRegistration(discordId) {
  await redis.del(rivalDuoPendingKey(discordId))
}

async function registerRivalDuoMember({
  discordId,
  name,
  heartbeatName,
  gameId,
  duoId = null
}) {
  discordId = String(discordId)
  gameId = String(gameId || "").trim()

  if (!isValidGameId(gameId)) {
    return {
      ok: false,
      message: "❌ ID must be exactly 16 digits."
    }
  }

  const existing = await getRivalDuoByUser(discordId)

  if (existing) {
    return {
      ok: false,
      message: "❌ You are already registered in a Rival Duo."
    }
  }

  let duo = null

  if (duoId) {
    duo = await getRivalDuoById(duoId)

    if (!duo) {
      return {
        ok: false,
        message: "❌ This Rival Duo no longer exists."
      }
    }

    if (isRivalDuoFull(duo)) {
      return {
        ok: false,
        message: "❌ This Rival Duo is already full."
      }
    }
  } else {
    duo = {
      id: createRivalDuoId(),
      createdAt: rivalNow(),
      members: {},
      onlineUsers: {},
      activeGameId: null,
      activeDiscordId: null,
      activeIndex: 0,
      lastRotationAt: 0,
      lastHeartbeatAt: {},
      lastHeartbeatStats: {},
      status: "waiting"
    }
  }

  duo.members[discordId] = {
    discordId,
    name: name || "Unknown",
    heartbeatName: heartbeatName || name || "Unknown",
    gameId,
    aliases: [
      name,
      heartbeatName
    ].filter(Boolean),
    joinedAt: rivalNow()
  }

  await saveRivalDuo(duo)
  await saveRivalDuoIndexes(duo)

  if (isRivalDuoFull(duo)) {
    return {
      ok: true,
      message: `✅ Rival Duo completed: **${displayRivalDuoName(duo)}**.`
    }
  }

  return {
    ok: true,
    message: "✅ Rival Duo created. Waiting for your reroll partner."
  }
}

async function removeRivalDuoIdsFromElite(duo) {
  const ids = getRivalDuoMembers(duo)
    .map(m => String(m.gameId || "").trim())
    .filter(isValidGameId)

  if (!ids.length) return

  await redis.srem("online:Elite_Four", ...ids)
}

async function activateRivalDuoId(duo, force = false) {
  const members = getRivalDuoMembers(duo)

  if (members.length < 2) {
    await removeRivalDuoIdsFromElite(duo)

    duo.activeGameId = null
    duo.activeDiscordId = null
    duo.status = "waiting_partner"

    await saveRivalDuo(duo)

    return {
      ok: false,
      waiting: true,
      message: "⏳ Waiting for reroll partner."
    }
  }

  const bothOnline = members.every(member => {
    return duo.onlineUsers?.[member.discordId] === true
  })

  if (!bothOnline) {
    await removeRivalDuoIdsFromElite(duo)

    duo.activeGameId = null
    duo.activeDiscordId = null
    duo.status = "waiting_partner"

    await saveRivalDuo(duo)

    return {
      ok: false,
      waiting: true,
      message: "⏳ Waiting for reroll partner."
    }
  }

  const now = rivalNow()

  const shouldRotate =
    force ||
    !duo.lastRotationAt ||
 //   now - Number(duo.lastRotationAt || 0) >= 60 * 60 * 1000
  now - Number(duo.lastRotationAt || 0) >= 2 * 60 * 1000

  if (!duo.activeGameId || shouldRotate) {
    const index = Number(duo.activeIndex || 0) % members.length
    const activeMember = members[index]

    await removeRivalDuoIdsFromElite(duo)

    duo.activeGameId = activeMember.gameId
    duo.activeDiscordId = activeMember.discordId
    duo.lastRotationAt = now
    duo.activeIndex = (index + 1) % members.length
    duo.status = "online"

    await redis.sadd("online:Elite_Four", activeMember.gameId)
    await saveRivalDuo(duo)

    return {
      ok: true,
      waiting: false,
      message: `🟢 Rival Duo online in Elite Four.\nActive ID: **${activeMember.gameId}**\nActive user: <@${activeMember.discordId}>`
    }
  }

  await redis.sadd("online:Elite_Four", duo.activeGameId)
  await saveRivalDuo(duo)

  return {
    ok: true,
    waiting: false,
    message: `🟢 Rival Duo already online.\nActive ID: **${duo.activeGameId}**\nActive user: <@${duo.activeDiscordId}>`
  }
}

async function setRivalDuoOnline(discordId) {
  const duo = await getRivalDuoByUser(discordId)

  if (!duo) {
    return {
      ok: false,
      message: "❌ You are not registered in a Rival Duo."
    }
  }

  if (!duo.onlineUsers) duo.onlineUsers = {}

  duo.onlineUsers[String(discordId)] = true

  await saveRivalDuo(duo)

  return await activateRivalDuoId(duo, false)
}

async function setRivalDuoOffline(discordId, reason = "offline") {
  const duo = await getRivalDuoByUser(discordId)

  if (!duo) {
    return {
      ok: false,
      message: "❌ You are not registered in a Rival Duo."
    }
  }

  await removeRivalDuoIdsFromElite(duo)

  duo.onlineUsers = {}
  duo.activeGameId = null
  duo.activeDiscordId = null
  duo.status = "offline"
  duo.offlineReason = reason
  duo.offlineAt = rivalNow()

  await saveRivalDuo(duo)

  return {
    ok: true,
    message: `🔴 Rival Duo offline: **${displayRivalDuoName(duo)}**.`
  }
}

async function tickRivalDuoRotation() {
  const duos = await loadAllRivalDuos()

  for (const duo of Object.values(duos)) {
    if (!duo) continue
    if (duo.status !== "online") continue

    await activateRivalDuoId(duo, false)
  }
}

async function changeRivalDuoGameId(discordId, newGameId) {
  discordId = String(discordId)
  newGameId = String(newGameId || "").trim()

  if (!isValidGameId(newGameId)) {
    return {
      ok: false,
      message: "❌ ID must be exactly 16 digits."
    }
  }

  const duo = await getRivalDuoByUser(discordId)

  if (!duo) {
    return {
      ok: false,
      message: "❌ You are not registered in a Rival Duo."
    }
  }

  const member = getRivalDuoMember(duo, discordId)

  if (!member) {
    return {
      ok: false,
      message: "❌ Rival Duo member data was not found."
    }
  }

  const oldGameId = String(member.gameId || "").trim()

  if (oldGameId === newGameId) {
    return {
      ok: true,
      message: `✅ Your Rival Duo ID is already **${newGameId}**.`
    }
  }

  if (oldGameId && isValidGameId(oldGameId)) {
    await redis.srem("online:Elite_Four", oldGameId)

    if (typeof redis.hdel === "function") {
      await redis.hdel(RIVAL_DUO_BY_GAMEID_KEY, oldGameId)
    } else {
      const indexes = await redis.hgetall(RIVAL_DUO_BY_GAMEID_KEY)

      if (indexes && typeof indexes === "object") {
        delete indexes[oldGameId]

        await redis.del(RIVAL_DUO_BY_GAMEID_KEY)

        if (Object.keys(indexes).length > 0) {
          await redis.hset(RIVAL_DUO_BY_GAMEID_KEY, indexes)
        }
      }
    }
  }

  member.gameId = newGameId
  member.updatedAt = rivalNow()

  duo.members[discordId] = member

  if (String(duo.activeDiscordId || "") === discordId) {
    duo.activeGameId = newGameId
    duo.lastRotationAt = rivalNow()

    if (duo.status === "online") {
      await redis.sadd("online:Elite_Four", newGameId)
    }
  }

  await saveRivalDuo(duo)
  await saveRivalDuoIndexes(duo)

  return {
    ok: true,
    message:
      `🔄 Rival Duo ID updated.\n` +
      `Old ID: ${oldGameId || "None"}\n` +
      `New ID: ${newGameId}`
  }
}

function formatRivalDuoTime(ms) {
  ms = Math.max(0, Number(ms) || 0)

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function getRivalDuoStatusLabel(duo) {
  const members = getRivalDuoMembers(duo)

  if (members.length < 2) return "⏳ Waiting Partner"

  const bothOnline = members.every(member => {
    return duo.onlineUsers?.[member.discordId] === true
  })

  if (duo.status === "online" && bothOnline && duo.activeGameId) {
    return "🟢 Online"
  }

  if (!bothOnline) {
    return "⏳ Waiting Both Online"
  }

  if (duo.status === "offline") {
    return "🔴 Offline"
  }

  return "⚫ Offline"
}

async function buildRivalDuoListMessage() {
  const duos = await loadAllRivalDuos()
  const list = Object.values(duos).filter(Boolean)

  if (!list.length) {
    return "📭 No Rival Duos registered."
  }

  const rotationMs = 60 * 60 * 1000

  let msg = "🤝 **Rival Duo List**\n\n"

  let index = 1

  for (const duo of list) {
    const members = getRivalDuoMembers(duo)
    const status = getRivalDuoStatusLabel(duo)

    const activeMember = members.find(m => {
      return String(m.discordId) === String(duo.activeDiscordId)
    })

    const nextMember = members.find(m => {
      return String(m.discordId) !== String(duo.activeDiscordId)
    })

    let elapsedText = "0s"
    let remainingText = "Not active"

    if (duo.status === "online" && duo.activeGameId && duo.lastRotationAt) {
      const elapsed = Date.now() - Number(duo.lastRotationAt || 0)
      const remaining = Math.max(0, rotationMs - elapsed)

      elapsedText = formatRivalDuoTime(elapsed)
      remainingText = formatRivalDuoTime(remaining)
    }

    msg += `**#${index} — ${displayRivalDuoName(duo)}**\n`
    msg += `Status: ${status}\n`

    if (members[0]) {
      const onlineIcon = duo.onlineUsers?.[members[0].discordId] ? "🟢" : "🔴"
      msg += `${onlineIcon} User A: <@${members[0].discordId}> | ID: \`${members[0].gameId}\`\n`
    } else {
      msg += `⚫ User A: Empty\n`
    }

    if (members[1]) {
      const onlineIcon = duo.onlineUsers?.[members[1].discordId] ? "🟢" : "🔴"
      msg += `${onlineIcon} User B: <@${members[1].discordId}> | ID: \`${members[1].gameId}\`\n`
    } else {
      msg += `⚫ User B: Empty\n`
    }

    if (duo.activeGameId) {
      msg += `Active ID: \`${duo.activeGameId}\`\n`
      msg += `Active user: ${activeMember ? `<@${activeMember.discordId}>` : "Unknown"}\n`
      msg += `Active time: **${elapsedText}**\n`
      msg += `Time left: **${remainingText}**\n`
      msg += `Next: ${nextMember ? `<@${nextMember.discordId}> | \`${nextMember.gameId}\`` : "Unknown"}\n`
    } else {
      msg += `Active ID: None\n`
      msg += `Time left: Not active\n`
    }

    msg += "\n"
    index++
  }

  if (msg.length > 1900) {
    msg = msg.slice(0, 1850) + "\n\n⚠️ List truncated because Discord messages have a size limit."
  }

  return msg
}
//tewmina



//Comandos
client.once("clientReady", async () => {
  console.log(`✅ Bot listo como ${client.user.tag}`);

 startDailyScheduler();

  setInterval(async () => {
  try {
    await tickRivalDuoRotation()
  } catch (err) {
    console.error("Rival Duo rotation error:", err)
  }
}, 60 * 1000)
  
 
  //console.log(`🧹 Limpiando comandos...`);

//  const { REST, Routes } = require("discord.js");
// const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  //try {
    // 🔥 BORRAR TODOS LOS COMANDOS DEL SERVIDOR
   // await rest.put(
    //  Routes.applicationGuildCommands(
      //  process.env.CLIENT_ID,
      // process.env.GUILD_ID
      //),
     // { body: [] }
   // );

  // console.log("✅ Comandos eliminados del servidor");
 // } catch (error) {
   // console.error("❌ Error borrando comandos:", error);
// }
//});
  




  const { REST, Routes, SlashCommandBuilder } = require("discord.js");

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);



  // 🔥 DEFINIR COMANDOS NUEVOS
  const commands = [
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register your main game ID")
    .addStringOption(option =>
      option.setName("id")
        .setDescription("Your 16 digit main ID")
        .setRequired(true)
    ),
new SlashCommandBuilder()
  .setName("change")
  .setDescription("Change your main game ID")
  .addStringOption(option =>
    option.setName("id")
      .setDescription("New 16 digit ID")
      .setRequired(true)
  ),

    new SlashCommandBuilder()
  .setName("register_duo")
  .setDescription("Register as Rival Duo member")
  .addStringOption(option =>
    option.setName("id")
      .setDescription("Your 16 digit Rival Duo ID")
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName("heartbeat_name")
      .setDescription("Exact name shown in your heartbeat")
      .setRequired(true)
  ),
new SlashCommandBuilder()
  .setName("duo_list")
  .setDescription("Show all Rival Duos and their active rotation status"),
new SlashCommandBuilder()
  .setName("heartbeat_name")
  .setDescription("Set your exact heartbeat name")
  .addStringOption(option =>
    option.setName("name")
      .setDescription("Exact name shown in your heartbeat")
      .setRequired(true)
  ),

   new SlashCommandBuilder()
  .setName("change_rol")
  .setDescription("Select your active group"),

    new SlashCommandBuilder()
      .setName("add_sec")
      .setDescription("Register your secondary game ID")
      .addStringOption(option =>
        option.setName("id")
          .setDescription("Your 16 digit secondary ID")
          .setRequired(true)
      ),



///////

new SlashCommandBuilder()
  .setName("schedule_events")
  .setDescription("Daily online/offline scheduler (UTC)")
  .addStringOption(opt =>
    opt.setName("mode")
      .setDescription("Start or Stop")
      .setRequired(true)
      .addChoices(
        { name: "Start Daily Schedule", value: "start" },
        { name: "Stop All Schedules", value: "stop" }
      )
  )
  .addIntegerOption(opt =>
    opt.setName("online_hour")
      .setDescription("Online Hour (UTC 0-23)")
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName("online_minute")
      .setDescription("Online Minute (0-59)")
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName("offline_hour")
      .setDescription("Offline Hour (UTC 0-23)")
      .setRequired(false)
  )
  .addIntegerOption(opt =>
    opt.setName("offline_minute")
      .setDescription("Offline Minute (0-59)")
      .setRequired(false)
  ),

new SlashCommandBuilder()
  .setName("set_offline")
  .setDescription("Force a user offline"),



   
/////
    new SlashCommandBuilder()
      .setName("online")
      .setDescription("Set your main account online"),

    new SlashCommandBuilder()
      .setName("online_sec")
      .setDescription("Set your secondary account online"),

    new SlashCommandBuilder()
      .setName("offline")
      .setDescription("Set your accounts offline"),

    new SlashCommandBuilder()
      .setName("list")
      .setDescription("List registered users"),

    new SlashCommandBuilder()
      .setName("online_list")
      .setDescription("List online users in your group"),

  new SlashCommandBuilder()
  .setName("add_vip")
  .setDescription("Add VIP ID")
  .addStringOption(option =>
    option.setName("id")
      .setDescription("16 digit VIP ID")
      .setRequired(true)
  )
  
      
      

  ].map(cmd => cmd.toJSON());

  try {

 //   // 🚀 REGISTRAR NUEVOS COMANDOS
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
     ),
      { body: commands }
    );

   console.log("✅ Slash commands registrados automáticamente");

  } catch (error) {
    console.error("❌ Error registrando comandos:", error);
 }
});
//termina comandos

//client.login(process.env.TOKEN)

// StartPPMCounter

const HEARTBEAT_CHANNEL_ID = "1483616146996465735"
const TOTAL_CHANNEL_ID = "1484416376436424794"

// ===== CONTADOR DE PPM =====
//const HISTORY_FILE = "./ppm_history.json";
//const TWELVE_HOURS = 12 * 60 * 60 * 1000;



// ====== NUEVO updateTotalPPM ======
//const HISTORY_FILE = "./ppm_history.json";
//const TWELVE_HOURS = 12 * 60 * 60 * 1000;

async function loadHistory() {
  try {
    const data = await redis.get(historyKey())
    return safeJsonParse(data, [])
  } catch (err) {
    console.error("Error loading history from Redis:", err)
    return []
  }
}

async function saveHistory(data) {
  try {
    await redis.set(historyKey(), JSON.stringify(data || []))
  } catch (err) {
    console.error("Error saving history to Redis:", err)
  }
}



client.on("interactionCreate", async (interaction) => {
  if (
    !interaction.isChatInputCommand() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isButton()
  ) return;

 // if (!interaction.isChatInputCommand()) return
  const { commandName } = interaction;

  const userId = interaction.user.id
  if (interaction.isChatInputCommand() && interaction.commandName === "register_duo") {
  const hasRole = interaction.member.roles.cache.some(r => r.name === "Rival_Duo")

  if (!hasRole) {
    return interaction.reply({
      content: "❌ You need the Rival_Duo role to use this command.",
      flags: MessageFlags.Ephemeral
    })
  }

  const gameId = interaction.options.getString("id").trim()
  const heartbeatName = interaction.options.getString("heartbeat_name").trim()

  if (!isValidId(gameId)) {
    return interaction.reply({
      content: "❌ ID must be exactly 16 digits.",
      flags: MessageFlags.Ephemeral
    })
  }

  const pending = {
    discordId: interaction.user.id,
    name: interaction.member?.displayName || interaction.user.username,
    heartbeatName,
    gameId
  }

  await savePendingRivalDuoRegistration(interaction.user.id, pending)

  const openDuos = await findOpenRivalDuos()

  if (!openDuos.length) {
    const result = await registerRivalDuoMember(pending)

    return interaction.reply({
      content: result.message,
      flags: MessageFlags.Ephemeral
    })
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rival_duo_select_${interaction.user.id}`)
    .setPlaceholder("Select open Duo or create new")
    .addOptions([
      {
        label: "Create new Rival Duo",
        value: "create_new"
      },
      ...openDuos.slice(0, 24).map(duo => ({
        label: displayRivalDuoName(duo).slice(0, 100),
        value: duo.id
      }))
    ])

  return interaction.reply({
    content: "There are open Rival Duo registrations. Select one or create a new Duo.",
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral
  })
}

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rival_duo_select_")) {
  const targetUserId = interaction.customId.replace("rival_duo_select_", "")

  if (interaction.user.id !== targetUserId) {
    return interaction.reply({
      content: "❌ This menu is not for you.",
      flags: MessageFlags.Ephemeral
    })
  }

  const pending = await loadPendingRivalDuoRegistration(interaction.user.id)

  if (!pending) {
    return interaction.update({
      content: "❌ Registration expired. Use /register_duo again.",
      components: []
    })
  }

  const selected = interaction.values[0]

  const result = await registerRivalDuoMember({
    ...pending,
    duoId: selected === "create_new" ? null : selected
  })

  await clearPendingRivalDuoRegistration(interaction.user.id)

  return interaction.update({
    content: result.message,
    components: []
  })
}
//  let users = await getUsers()
  if (interaction.isChatInputCommand() && interaction.commandName === "duo_list") {
  const hasRole =
    interaction.member.roles.cache.some(r => r.name === "Rival_Duo") ||
    interaction.member.roles.cache.some(r => r.name === "Champion")

  if (!hasRole) {
    return interaction.reply({
      content: "❌ You need the Rival_Duo or Champion role to use this command.",
      flags: MessageFlags.Ephemeral
    })
  }

  const message = await buildRivalDuoListMessage()

  return interaction.reply({
    content: message,
    flags: MessageFlags.Ephemeral
  })
}

//SCHENDULE

if (interaction.commandName === "schedule_events") {

  const mode = interaction.options.getString("mode")
  const schedules = await loadSchedules()

const now = new Date()

const utcNow = now.toISOString().slice(11,16) // HH:MM en UTC real 24h
  if (mode === "stop") {

    delete schedules[interaction.user.id]
    await saveSchedules(schedules)

    return interaction.reply(`🛑 All daily schedules stopped.\n🕒 Current UTC time: ${utcNow}`)
  }

  const group = await getUserGroup(interaction)
  if (!group) return interaction.reply("❌ No reroll group detected")

  const config = GROUP_CONFIG[group]

  let users = await getUsers(group)
  const userData = users[interaction.user.id]

  if (!userData?.main_id) {
    return interaction.reply("❌ You must register first")
  }

  const onlineHour = interaction.options.getInteger("online_hour")
  const onlineMinute = interaction.options.getInteger("online_minute")
  const offlineHour = interaction.options.getInteger("offline_hour")
  const offlineMinute = interaction.options.getInteger("offline_minute")

  if (
    onlineHour == null || onlineMinute == null ||
    offlineHour == null || offlineMinute == null
  ) {
    return interaction.reply("❌ You must provide all time values")
  }

  if (
    onlineHour < 0 || onlineHour > 23 ||
    offlineHour < 0 || offlineHour > 23 ||
    onlineMinute < 0 || onlineMinute > 59 ||
    offlineMinute < 0 || offlineMinute > 59
  ) {
    return interaction.reply("❌ Invalid UTC time format")
  }

  schedules[interaction.user.id] = {
    group,
    main_id: userData.main_id,
    online_hour: onlineHour,
    online_minute: onlineMinute,
    offline_hour: offlineHour,
    offline_minute: offlineMinute,
    last_online: null,
    last_offline: null
  }

  saveSchedules(schedules)

  return interaction.reply(
    `✅ Daily schedule activated\n\n` +
    `🟢 Online: ${onlineHour.toString().padStart(2,"0")}:${onlineMinute.toString().padStart(2,"0")} UTC\n` +
    `🔴 Offline: ${offlineHour.toString().padStart(2,"0")}:${offlineMinute.toString().padStart(2,"0")} UTC\n\n` +
    `🕒 Current UTC time: ${utcNow}`
  )
}



 
// 🔹 VIP ids
// 🔹 GP COMMAND (solo Champion + selector de grupo)
if (interaction.commandName === "add_vip") {

  const CHAMPION_ROLE_ID = "1486206362332434634"; // 👈 tu rol Champion

  // ❌ Solo funciona dentro de servidor
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: "❌ This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral
    });
  }

  const member = interaction.member;

  // 🔒 Verificar rol Champion
  if (!member.roles.cache.has(CHAMPION_ROLE_ID)) {
    return interaction.reply({
      content: "⛔ Only Champions can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const id = interaction.options.getString("id");

  if (!/^\d{16}$/.test(id)) {
    return interaction.reply({
      content: "❌ ID must be 16 digits",
      flags: MessageFlags.Ephemeral
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`select_gp_group_${id}`)
    .setPlaceholder("Select group to add GP")
    .addOptions([
      {
        label: "Trainer",
        value: "Trainer"
      },
      {
        label: "Gym Leader",
        value: "Gym_Leader"
      },
      {
        label: "Elite Four",
        value: "Elite_Four"
      }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    content: `🔥 Select group to add VIP ID:\n\`${id}\``,
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

if (interaction.commandName === "heartbeat_name") {
  const group = await getUserGroup(interaction)

  if (!group) {
    return interaction.reply({
      content: "❌ No group",
      flags: MessageFlags.Ephemeral
    })
  }

  const heartbeatName = interaction.options.getString("name").trim()

  if (!heartbeatName) {
    return interaction.reply({
      content: "❌ Invalid heartbeat name.",
      flags: MessageFlags.Ephemeral
    })
  }

  let users = await getUsers(group)
  const oldData = users[interaction.user.id]

  if (!oldData?.main_id) {
    return interaction.reply({
      content: "❌ You must register first.",
      flags: MessageFlags.Ephemeral
    })
  }

  users[interaction.user.id] = buildUserData(oldData, interaction, {
    heartbeatName,
    aliases: uniqueList([
      ...(Array.isArray(oldData.aliases) ? oldData.aliases : []),
      oldData.name,
      oldData.heartbeatName,
      heartbeatName
    ])
  })

  await saveUsers(users, group)

  return interaction.reply({
    content:
      `✅ Heartbeat name updated.\n` +
      `👤 Display name: **${users[interaction.user.id].name}**\n` +
      `📡 Heartbeat name: **${users[interaction.user.id].heartbeatName}**`,
    flags: MessageFlags.Ephemeral
  })
}
  
//tegister

if (interaction.commandName === "register") {

  const group = await getUserGroup(interaction);

  if (!group) {
    return interaction.reply("❌ No group");
  }

  const config = GROUP_CONFIG[group];
  const id = interaction.options.getString("id");

  if (!/^\d{16}$/.test(id)) {
    return interaction.reply("❌ ID must be 16 digits");
  }

  let users = await getUsers(group)

  const oldData = users[interaction.user.id] || {};

users[interaction.user.id] = buildUserData(oldData, interaction, {
  main_id: id,
  sec_id: oldData.sec_id || null
});

await saveUsers(users, group)

return interaction.reply(
  `✅ Main ID registered in **${group}**\n` +
  `👤 Display name: **${users[interaction.user.id].name}**\n` +
  `📡 Heartbeat name: **${users[interaction.user.id].heartbeatName}**`
);
}

  // 🔥 Guardar en archivo correcto del gist correcto       

//adsec
if (interaction.commandName === "add_sec") {

const group = await getUserGroup(interaction);

if (!group) {
  return interaction.reply("❌ No group");
}

  const config = GROUP_CONFIG[group]

  const secId = interaction.options.getString("id")

  if (!/^\d{16}$/.test(secId)) {
    return interaction.reply("❌ ID must be 16 digits")
  }

  // 🔥 Cargar desde el archivo correcto
  let users = await getUsers(group)

  const userData = users[interaction.user.id]

  if (!userData) {
    return interaction.reply("❌ You must register main ID first")
  }

users[interaction.user.id] = buildUserData(userData, interaction, {
  sec_id: secId
})

await saveUsers(users, group)

return interaction.reply("✅ Secondary ID added")
}


//change

if (interaction.commandName === "change") {

try {

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const newId = interaction.options.getString("id")

  if (!/^\d{16}$/.test(newId)) {
    return interaction.editReply("❌ ID must be exactly 16 digits (numbers only)")
  }

if (await isActiveRivalDuo(interaction)) {
  const result = await changeRivalDuoGameId(interaction.user.id, newId)
  return interaction.editReply(result.message)
}

const group = await getUserGroup(interaction)
    if (!group) {
      return interaction.editReply("❌ You don't belong to any reroll group")
    }

    const config = GROUP_CONFIG[group]


    // 🔥 Cargar correctamente el archivo del grupo
    let users = await getUsers(group)

    const userData = users[interaction.user.id]

    if (!userData) {
      return interaction.editReply("❌ You must register first")
    }

    // 🔴 Poner OFFLINE el main_id anterior
if (userData.main_id) {
  const okOffline = await setOnlineStatus("offline", userData.main_id, group);
  if (!okOffline) {
    console.error("Error putting old ID offline:", userData.main_id);
  }
}

    // 🔄 Actualizar manteniendo sec_id
users[interaction.user.id] = buildUserData(userData, interaction, {
  main_id: newId,
  sec_id: userData.sec_id || null
})

await saveUsers(users, group)

return interaction.editReply(
  `🔄 Main ID updated in **${group}**\n` +
  `👤 Display name: **${users[interaction.user.id].name}**\n` +
  `📡 Heartbeat name: **${users[interaction.user.id].heartbeatName}**`
)

  } catch (error) {

    console.error("CHANGE ERROR:", error)

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply("❌ Unexpected error updating ID")
    } else {
      return interaction.reply("❌ Unexpected error updating ID")
    }
  }
}

  
  if (interaction.commandName === "online") {
if (await isActiveRivalDuo(interaction)) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const result = await setRivalDuoOnline(interaction.user.id)

  return interaction.editReply(result.message)
}

const group = await getUserGroup(interaction);

if (!group) {
  return interaction.reply("❌ No group");
}

  const config = GROUP_CONFIG[group]

  let users = await getUsers(group)

  const userData = users[interaction.user.id]

  // 🔥 CAMBIO IMPORTANTE
  if (!userData || !userData.main_id) {
    return interaction.reply("❌ You must register your main ID first")
  }

await interaction.deferReply({ flags: MessageFlags.Ephemeral })

const ok = await setOnlineStatus("online", userData.main_id, group);

if (!ok) {
  return interaction.editReply("❌ Could not set main account online.");
}

return interaction.editReply("🟢 Main account set online. It now appears in /online_list.");
}


//online sec
if (interaction.commandName === "online_sec") {
 if (await isActiveRivalDuo(interaction)) {
  return interaction.reply({
    content: "❌ Rival Duo does not use secondary ID. Use /online instead.",
    flags: MessageFlags.Ephemeral
  })
}

const group = await getUserGroup(interaction);

if (!group) {
  return interaction.reply("❌ No group");
}

  const config = GROUP_CONFIG[group]

  let users = await getUsers(group)

  const userData = users[interaction.user.id]

  if (!userData || !userData.sec_id) {
    return interaction.reply("❌ You must register your secondary ID first")
  }

await interaction.deferReply({ flags: MessageFlags.Ephemeral })

const ok = await setOnlineStatus("online", userData.sec_id, group);

if (!ok) {
  return interaction.editReply("❌ Could not set secondary account online.");
}

return interaction.editReply("🟢 Secondary account set online. It now appears in /online_list.");
}




 

  // 🔹 OFFLINE
  if (interaction.commandName === "offline") {

  await interaction.deferReply()
   if (await isActiveRivalDuo(interaction)) {
  const result = await setRivalDuoOffline(interaction.user.id, "manual_offline")

  return interaction.editReply(result.message)
}

  // 🔎 Detectar grupo por rol
  const group = await getUserGroup(interaction)

  if (!group) {
    return interaction.editReply("❌ You don't belong to any reroll group")
  }

  const config = GROUP_CONFIG[group]

  // 📂 Cargar users del grupo correcto
let users = await getUsers(group)

  const userData = users[interaction.user.id]

  if (!userData) {
    return interaction.editReply("❌ You are not registered in your group")
  }

  // 🌐 Llamar API con grupo
let okMain = true;
let okSec = true;

if (userData.main_id) {
  okMain = await setOnlineStatus("offline", userData.main_id, group);
}

if (userData.sec_id) {
  okSec = await setOnlineStatus("offline", userData.sec_id, group);
}

if (!okMain || !okSec) {
  return interaction.editReply("❌ Some IDs could not be updated.");
}

return interaction.editReply(`🔴 ${userData.name} is now OFFLINE in ${group}`);
}
 
//SETOFFLINE

if (interaction.commandName === "set_offline") {
  const member = interaction.member;

  if (!member.roles.cache.some(role => role.name === "Champion")) {
    return interaction.reply({
      content: "❌ You need the **Champion** role to use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_offline_group")
    .setPlaceholder("Select group")
    .addOptions([
      {
        label: "Trainer",
        value: "Trainer"
      },
      {
        label: "Gym Leader",
        value: "Gym_Leader"
      },
      {
        label: "Elite Four",
        value: "Elite_Four"
      }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    content: "Select the group:",
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

// 🔹 SELECT GP GROUP
if (interaction.isStringSelectMenu() && interaction.customId.startsWith("select_gp_group_")) {

  const id = interaction.customId.replace("select_gp_group_", "")
  const group = interaction.values[0]

  if (!GROUP_CONFIG[group]) {
    return interaction.update({
      content: "❌ Invalid group",
      components: []
    })
  }

  await addVipID(id, group)

  return interaction.update({
    content: `✅ VIP ID \`${id}\` added to **${group}**`,
    components: []
  })
}



if (interaction.isStringSelectMenu() && interaction.customId === "select_active_role") {

  const selected = interaction.values[0]

  await redis.hset(activeRolesKey(), {
    [interaction.user.id]: selected
  })

  return interaction.update({
    content: `✅ Active role set to **${getSelectableRoleLabel(selected)}**`,
    components: []
  })
}
if (interaction.isStringSelectMenu() && interaction.customId === "select_offline_group") {

  const group = interaction.values[0];

  if (!GROUP_CONFIG[group]) {
    return interaction.update({
      content: "❌ Invalid group selected.",
      components: []
    });
  }

  const onlineUsers = await getOnlineUsersByGroup(group);

  if (onlineUsers.length === 0) {
    return interaction.update({
      content: `⚫ No active users in **${group}**`,
      components: []
    });
  }

  const options = onlineUsers.slice(0, 25).map(user => ({
    label: user.label,
    description: user.id,
    value: `${group}|${user.id}`
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_offline_user")
    .setPlaceholder("Select active user")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.update({
    content: `Select active user from **${group}**:`,
    components: [row]
  });
}
 
 
//////
if (interaction.isStringSelectMenu() && interaction.customId === "select_offline_user") {

  const selected = interaction.values[0];
  const [group, id] = selected.split("|");

  const confirm = new ButtonBuilder()
    .setCustomId(`confirm_offline_${group}|${id}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(confirm);

  await interaction.update({
    content: `⚠️ Confirm OFFLINE for ID: ${id}\n📂 Group: ${group}`,
    components: [row]
  });
}

if (interaction.isButton() && interaction.customId.startsWith("confirm_offline_")) {

  const raw = interaction.customId.replace("confirm_offline_", "");
  const [group, id] = raw.split("|");

  if (!GROUP_CONFIG[group] || !id) {
    return interaction.update({
      content: "❌ Invalid offline action.",
      components: []
    });
  }

const ok = await setOnlineStatus("offline", id, group);

if (!ok) {
  return interaction.update({
    content: "❌ Could not set this ID offline.",
    components: []
  });
}

await interaction.update({
  content: `🔴 ID ${id} set OFFLINE in **${group}**`,
  components: []
});
}
 //////////

// 🔹 LIST
if (interaction.commandName === "list") {

  const group = await getUserGroup(interaction);
  if (!group) {
    return interaction.reply("❌ No reroll group detected");
  }

 const registeredUsers = await getUsers(group)

  if (Object.keys(registeredUsers).length === 0) {
    return interaction.reply("📭 No users registered");
  }

  let msg = `📋 **Registered users in ${group}:**\n\n`;

  for (const uid in registeredUsers) {
    const user = registeredUsers[uid];
    msg += `👤 ${user.name} | 📡 ${user.heartbeatName || user.name} → Main ID: ${user.main_id}\n`;
  }

  return interaction.reply(msg);
}

 // 🔹 ONLINE LIST
if (interaction.commandName === "online_list") {
  try {
    await interaction.deferReply();

    const group = await getUserGroup(interaction);
    if (!group)
      return interaction.editReply("❌ You don't belong to any reroll group");

    const onlineIds = await getOnlineIDs(group)

    if (onlineIds.length === 0)
      return interaction.editReply(`⚫ No users online in ${group}`);

    // 🔹 Obtener usuarios registrados del grupo
    const registeredUsers = await getUsers(group)

    let msg = `🟢 **Online users in ${group}:**\n\n`;
    let found = false;

    // 🔥 Optimizado (sin doble loop innecesario)
 // 🔥 Mostrar Main y Sec correctamente si están online
for (const uid in registeredUsers) {
  const user = registeredUsers[uid];

  const mainId = (user.main_id || "").trim();
  const secId = (user.sec_id || "").trim();

  const mainOnline = mainId && onlineIds.includes(mainId);
  const secOnline = secId && onlineIds.includes(secId);

  if (mainOnline || secOnline) {
    const shownIds = [];

    if (mainOnline) shownIds.push(`Main: ${mainId}`);
    if (secOnline) shownIds.push(`Sec: ${secId}`);

    msg += `👤 ${user.name} | 📡 ${user.heartbeatName || user.name} → ${shownIds.join(" | ")}\n`;
    found = true;
  }
}

    if (!found)
      msg += "⚫ No registered users online\n";

    return interaction.editReply(msg);

  } catch (error) {
    console.error("Online list error:", error);
    return interaction.editReply("❌ Something went wrong");
  }
}

/////change_rol

if (interaction.commandName === "change_rol") {

  const member = interaction.member;

  const userGroups = getMemberSelectableRoles(member)

  if (userGroups.length === 0) {
    return interaction.reply({
      content: "❌ You don't have any valid reroll roles.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (userGroups.length === 1) {
    return interaction.reply({
      content: `⚠️ You only have one role (**${getSelectableRoleLabel(userGroups[0])}**).\nYou need at least 2 roles to switch.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const options = userGroups.map(group => ({
    label: getSelectableRoleLabel(group),
    value: group
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("select_active_role")
    .setPlaceholder("Select your active group")
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);

  return interaction.reply({
    content: "🎯 Select your active group:",
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}


 

if (commandName === "editpanel") {
  try {
    // Verificar si el usuario tiene el rol Champion
    const member = interaction.member; // miembro que ejecuta el comando
    if (!member.roles.cache.some(role => role.name === "Champion")) {
      return interaction.reply({
        content: "❌ You need the **Champion** role to use this command.",
        flags: MessageFlags.Ephemeral
      });
    }

    // ----- Resto del comando aquí -----
    await interaction.reply({
      content: "📝 Please send the **Message ID** of the panel you want to edit:",
      flags: MessageFlags.Ephemeral
    });

    const filter = m => m.author.id === interaction.user.id;
    const collectedId = await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 60000,
      errors: ["time"]
    });
    const messageId = collectedId.first().content.trim();

    const message = await interaction.channel.messages.fetch(messageId).catch(() => null);
    if (!message) {
      return interaction.followUp({ content: "❌ Message not found.", flags: MessageFlags.Ephemeral });
    }

    if (!message.embeds.length) {
      return interaction.followUp({ content: "❌ That message has no embed.", flags: MessageFlags.Ephemeral });
    }

    await interaction.followUp({
      content: "🔢 Now, please send the new **Rarity (1-5)**:",
      flags: MessageFlags.Ephemeral
    });

    const collectedRarity = await interaction.channel.awaitMessages({
      filter,
      max: 1,
      time: 60000,
      errors: ["time"]
    });

    const rarityInput = parseInt(collectedRarity.first().content.trim());
    if (isNaN(rarityInput) || rarityInput < 1 || rarityInput > 5) {
      return interaction.followUp({
        content: "❌ Invalid rarity. Must be a number between 1 and 5.",
        flags: MessageFlags.Ephemeral
      });
    }

    const oldEmbed = message.embeds[0];

    let color = 0x999999;
    if (rarityInput === 5) color = 0xFFD700;
    if (rarityInput === 4) color = 0x00ffcc;
    if (rarityInput === 3) color = 0x0099ff;

    const descMatch = oldEmbed.description?.match(/• (\d+)P\s+\|\s+\*\*(.+)\*\*/i);
    const pack = descMatch ? parseInt(descMatch[1]) : 1;
    const username = descMatch ? descMatch[2] : "Unknown";

    const newEmbed = new EmbedBuilder()
      .setColor(color)
      .setDescription(`## ✨ ${rarityInput}/5 • ${pack}P  |  **${username}**`);

    if (oldEmbed.image?.url) newEmbed.setImage(oldEmbed.image.url);

    await message.edit({ embeds: [newEmbed] });

    await interaction.followUp({
      content: `✅ Panel updated successfully to **${rarityInput}/5**!`,
      flags: MessageFlags.Ephemeral
    });

  } catch (err) {
    console.error("EDIT PANEL ERROR:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Something went wrong.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
}
});
    
  // 🔹 CIERRE CORRECTO DE client.on("interactionCreate")

    

client.on("messageCreate", async (message) => {

  // permitir webhooks o bots específicos
if (message.author.bot && !message.webhookId) return

  const text = message.content || ""
  const match = text.match(/\((\d{16})\)/)

  if (!match) return

  const id = match[1]

  // 🔥 detectar grupo por ID del canal
  const group = CHANNEL_GROUP_MAP[message.channel.id]

  if (!group) {
    console.log("⚠️ Canal no configurado:", message.channel.id)
    return
  }

  console.log(`🔥 GP detectado en ${group}:`, id)

  await addVipID(id, group)
})

client.login(TOKEN)
