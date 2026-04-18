 const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder,
  TextInputBuilder,TextInputStyle,ActionRowBuilder,StringSelectMenuBuilder, ButtonBuilder, ButtonStyle} = require('discord.js')
const fetch = require('node-fetch')




const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
})

const TOKEN = process.env.TOKEN
const API_URL = "https://add-ids.netlify.app/.netlify/functions/api"


const GITHUB_TOKEN = process.env.GITHUB_TOKEN

//detecta onlineppm
const GROUP_CONFIG = {
  Trainer: {
   VIP_FILENAME:"trainer_vip.txt",
   IDS_FILENAME:"trainer_ids.txt",
    USERS_FILENAME: "trainer_users.json",
    USERS_GIST_ID: "1c066922bc39ac136b6f234fad6d9420",
    IDS_GIST_ID: "4edcf4d341cd4f7d5d0fb8a50f8b8c3c",
    VIP_GIST_ID: "16541fd83785a49ad4a0f22bbeb06000"
  },
  Gym_Leader: {
   VIP_FILENAME:"gym_vip.txt",
   IDS_FILENAME:"gym_ids.txt",
    USERS_FILENAME: "gym_users.json",
    USERS_GIST_ID: "a3f5f3d8a2e6ddf2378fb3481dff49f6",
    IDS_GIST_ID: "e110c37b3e0b8de83a33a1b0a5eb64e8",
    VIP_GIST_ID: "79a0e30c401cfd63e78d9ec5a9210091"
  },
  Elite_Four: {
   VIP_FILENAME:"elite_vip.txt",
   IDS_FILENAME:"elite_ids.txt",
    USERS_FILENAME: "elite_users.json",
    USERS_GIST_ID: "bb18eda2ea748723d8fe0131dd740b70",
    IDS_GIST_ID: "d9db3a72fed74c496fd6cc830f9ca6e9",
    VIP_GIST_ID: "5f2f23e0391882ab4e255bd67e98334a"
  }
}
const CHANNEL_GROUP_MAP = {
  "1486277594629275770": "Elite_Four",  // canal elite
  "1487362022864588902": "Trainer",     // canal trainer
  "1484015417411244082": "Gym_Leader"   // canal gym
}

const ACTIVE_ROLE_GIST_ID = "49c42c0a844bbc4d2c0187fc254140d1"
const ACTIVE_ROLE_FILE = "active_roles.json"

async function getUserGroup(interaction) {

  const activeRoles = await getActiveRoles()

  // 🔥 1. si tiene override guardado
  if (activeRoles[interaction.user.id]) {
    return activeRoles[interaction.user.id]
  }

  // 🔹 2. fallback al rol real
  const member = interaction.member

  const role = member.roles.cache.find(r =>
    Object.keys(GROUP_CONFIG).includes(r.name)
  )

  if (!role) return null

  return role.name
}


async function getOnlineIDs(gistId, fileName) {
  try {
    const res = await fetch(
      `https://api.github.com/gists/${gistId}?t=${Date.now()}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Cache-Control": "no-cache"
        }
      }
    );

    if (!res.ok) {
      console.log("GitHub read error:", res.status);
      return [];
    }

    const data = await res.json();
    const content = data.files[fileName]?.content || "";

    return content
      .split("\n")
      .map(x => x.trim())
      .filter(x => x.length > 0);

  } catch (err) {
    console.error("Error leyendo ids:", err);
    return [];
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
  const config = GROUP_CONFIG[group];
  if (!config) return [];

  const onlineIds = await getOnlineIDs(config.IDS_GIST_ID, config.IDS_FILENAME);
  if (!onlineIds.length) return [];

  const users = await getUsers(config.USERS_GIST_ID, config.USERS_FILENAME);

  const results = [];

  for (const id of onlineIds) {
    let foundUser = null;

    for (const uid in users) {
      const u = users[uid];
      if (u.main_id === id || u.sec_id === id) {
        foundUser = u;
        break;
      }
    }

    results.push({
      id,
      label: buildUserLabel(foundUser, id),
      user: foundUser
    });
  }

  return results;
}




//termina
const fs = require("fs")

const HISTORY_FILE = "./ppm_history.json"
const TWELVE_HOURS = 12 * 60 * 60 * 1000

// ================= DAILY SCHEDULE SYSTEM =================

const SCHEDULE_FILE = "./daily_schedules.json"

function loadSchedules() {
  if (!fs.existsSync(SCHEDULE_FILE)) return {}
  return JSON.parse(fs.readFileSync(SCHEDULE_FILE))
}

function saveSchedules(data) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2))
}

function startDailyScheduler() {

  setInterval(async () => {

    const schedules = loadSchedules()
    const now = new Date()

    const utcHour = now.getUTCHours()
    const utcMinute = now.getUTCMinutes()
    const todayUTC = now.toISOString().slice(0,10)

    for (const userId in schedules) {

      const data = schedules[userId]
      if (!data.group || !data.main_id) continue

      // ONLINE
      if (
        data.online_hour === utcHour &&
        data.online_minute === utcMinute &&
        data.last_online !== todayUTC
      ) {
        await fetch(`${API_URL}?action=online&id=${data.main_id}&group=${data.group}`)
        data.last_online = todayUTC
        console.log("🟢 Daily ONLINE ejecutado:", data.main_id)
      }

      // OFFLINE
      if (
        data.offline_hour === utcHour &&
        data.offline_minute === utcMinute &&
        data.last_offline !== todayUTC
      ) {
        await fetch(`${API_URL}?action=offline&id=${data.main_id}&group=${data.group}`)
        data.last_offline = todayUTC
        console.log("🔴 Daily OFFLINE ejecutado:", data.main_id)
      }

    }

    saveSchedules(schedules)

  }, 60 * 1000)

}


function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return []
  return JSON.parse(fs.readFileSync(HISTORY_FILE))
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data))
}

//let onlineUsers = {}

async function getUsers(gistId, fileName) {
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Cache-Control": "no-cache"
      }
    })

    const data = await res.json()

    if (!data.files || !data.files[fileName]) {
      return {}
    }

    return JSON.parse(data.files[fileName].content || "{}")

  } catch (err) {
    console.error("Error loading users:", err)
    return {}
  }
}
async function getActiveRoles() {
  try {
    const res = await fetch(`https://api.github.com/gists/${ACTIVE_ROLE_GIST_ID}?t=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    const data = await res.json();

    if (!data.files || !data.files[ACTIVE_ROLE_FILE]) return {};

    return JSON.parse(data.files[ACTIVE_ROLE_FILE].content || "{}");

  } catch (err) {
    console.error("Error loading active roles:", err);
    return {};
  }
}

async function saveActiveRoles(data) {
  await fetch(`https://api.github.com/gists/${ACTIVE_ROLE_GIST_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json"
    },
    body: JSON.stringify({
      files: {
        [ACTIVE_ROLE_FILE]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    })
  });
}

async function saveUsers(users, gistId, fileName) {
  await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json"
    },
    body: JSON.stringify({
      files: {
        [fileName]: {
          content: JSON.stringify(users, null, 2)
        }
      }
    })
  })
}






//advio
async function addVipID(id, group) {
  try {
    const config = GROUP_CONFIG[group]
    if (!config) return console.log("❌ Grupo inválido")

    const res = await fetch(`https://api.github.com/gists/${config.VIP_GIST_ID}?t=${Date.now()}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Cache-Control": "no-cache"
      }
    })

    const data = await res.json()

    let content = data.files[config.VIP_FILENAME]?.content || ""

    const ids = content.split("\n").filter(Boolean)

    if (ids.includes(id)) return

    ids.push(id)

    await fetch(`https://api.github.com/gists/${config.VIP_GIST_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      },
      body: JSON.stringify({
        files: {
          [config.VIP_FILENAME]: {
            content: ids.join("\n")
          }
        }
      })
    })

    console.log(`✅ VIP añadido en ${group}:`, id)

  } catch (err) {
    console.error("Error VIP:", err)
  }
}

//tewmina



//Comandos
client.once("ready", async () => {
  console.log(`✅ Bot listo como ${client.user.tag}`);
 
  //console.log(`🧹 Limpiando comandos...`);

//  const { REST, Routes } = require("discord.js");
// const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

//  try {
    // 🔥 BORRAR TODOS LOS COMANDOS DEL SERVIDOR
 //   await rest.put(
  //    Routes.applicationGuildCommands(
    //    process.env.CLIENT_ID,
    //    process.env.GUILD_ID
   //   ),
  //    { body: [] }
 //   );

 //   console.log("✅ Comandos eliminados del servidor");
 // } catch (error) {
//    console.error("❌ Error borrando comandos:", error);
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

    new SlashCommandBuilder()
      .setName("change")
      .setDescription("Change your main game ID")
      .addStringOption(option =>
        option.setName("id")
          .setDescription("New 16 digit ID")
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

client.login(process.env.TOKEN)

// StartPPMCounter

const HEARTBEAT_CHANNEL_ID = "1483616146996465735"
const TOTAL_CHANNEL_ID = "1484416376436424794"

// ===== CONTADOR DE PPM =====
//const HISTORY_FILE = "./ppm_history.json";
//const TWELVE_HOURS = 12 * 60 * 60 * 1000;

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE));
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data));
}

// ====== NUEVO updateTotalPPM ======
//const HISTORY_FILE = "./ppm_history.json";
//const TWELVE_HOURS = 12 * 60 * 60 * 1000;

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE));
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data));
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
//  let users = await getUsers()

//SCHENDULE

if (interaction.commandName === "schedule_events") {

  const mode = interaction.options.getString("mode")
  const schedules = loadSchedules()

const now = new Date()

const utcNow = now.toISOString().slice(11,16) // HH:MM en UTC real 24h
  if (mode === "stop") {

    delete schedules[interaction.user.id]
    saveSchedules(schedules)

    return interaction.reply(`🛑 All daily schedules stopped.\n🕒 Current UTC time: ${utcNow}`)
  }

  const group = await getUserGroup(interaction)
  if (!group) return interaction.reply("❌ No reroll group detected")

  const config = GROUP_CONFIG[group]

  let users = await getUsers(config.USERS_GIST_ID, config.USERS_FILENAME)
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
      ephemeral: true
    });
  }

  const member = interaction.member;

  // 🔒 Verificar rol Champion
  if (!member.roles.cache.has(CHAMPION_ROLE_ID)) {
    return interaction.reply({
      content: "⛔ Only Champions can use this command.",
      ephemeral: true
    });
  }

  const id = interaction.options.getString("id");

  if (!/^\d{16}$/.test(id)) {
    return interaction.reply({
      content: "❌ ID must be 16 digits",
      ephemeral: true
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
    ephemeral: true
  });
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

  let users = await getUsers(
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  );

  const oldData = users[interaction.user.id] || {};

  users[interaction.user.id] = {
    main_id: id,
    sec_id: oldData.sec_id || null,
    name: interaction.member.displayName
  };

  await saveUsers(
    users,
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  );

  return interaction.reply(`✅ Main ID registered in ${group}`);
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
  let users = await getUsers(
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  )

  const userData = users[interaction.user.id]

  if (!userData) {
    return interaction.reply("❌ You must register main ID first")
  }

  userData.sec_id = secId

  // 🔥 Guardar en el archivo correcto
  await saveUsers(
    users,
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  )

  return interaction.reply("✅ Secondary ID added")
}


//change

if (interaction.commandName === "change") {

  try {

    await interaction.deferReply({ ephemeral: true })

const group = await getUserGroup(interaction)
    if (!group) {
      return interaction.editReply("❌ You don't belong to any reroll group")
    }

    const config = GROUP_CONFIG[group]

    const newId = interaction.options.getString("id")

    if (!/^\d{16}$/.test(newId)) {
      return interaction.editReply("❌ ID must be exactly 16 digits (numbers only)")
    }

    // 🔥 Cargar correctamente el archivo del grupo
    let users = await getUsers(
      config.USERS_GIST_ID,
      config.USERS_FILENAME
    )

    const userData = users[interaction.user.id]

    if (!userData) {
      return interaction.editReply("❌ You must register first")
    }

    // 🔴 Poner OFFLINE el main_id anterior
    if (userData.main_id) {
      try {
        await fetch(`${API_URL}?action=offline&id=${userData.main_id}&group=${group}`)
      } catch (e) {
        console.error("Error putting old ID offline:", e)
      }
    }

    // 🔄 Actualizar manteniendo sec_id
    users[interaction.user.id] = {
      main_id: newId,
      sec_id: userData.sec_id || null,
      name: interaction.member.displayName
    }

    await saveUsers(
      users,
      config.USERS_GIST_ID,
      config.USERS_FILENAME
    )

    return interaction.editReply(`🔄 Main ID updated in ${group}`)

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

const group = await getUserGroup(interaction);

if (!group) {
  return interaction.reply("❌ No group");
}

  const config = GROUP_CONFIG[group]

  let users = await getUsers(
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  )

  const userData = users[interaction.user.id]

  // 🔥 CAMBIO IMPORTANTE
  if (!userData || !userData.main_id) {
    return interaction.reply("❌ You must register your main ID first")
  }

  await fetch(`${API_URL}?action=online&id=${userData.main_id}&group=${group}`)

  return interaction.reply("🟢 Main account set online")
}


//online sec
if (interaction.commandName === "online_sec") {

const group = await getUserGroup(interaction);

if (!group) {
  return interaction.reply("❌ No group");
}

  const config = GROUP_CONFIG[group]

  let users = await getUsers(
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  )

  const userData = users[interaction.user.id]

  if (!userData || !userData.sec_id) {
    return interaction.reply("❌ You must register your secondary ID first")
  }

  await fetch(`${API_URL}?action=online&id=${userData.sec_id}&group=${group}`)

  return interaction.reply("🟢 Secondary account set online")
}




 

  // 🔹 OFFLINE
  if (interaction.commandName === "offline") {

  await interaction.deferReply()

  // 🔎 Detectar grupo por rol
  const group = await getUserGroup(interaction)

  if (!group) {
    return interaction.editReply("❌ You don't belong to any reroll group")
  }

  const config = GROUP_CONFIG[group]

  // 📂 Cargar users del grupo correcto
let users = await getUsers(
  config.USERS_GIST_ID,
  config.USERS_FILENAME
)

  const userData = users[interaction.user.id]

  if (!userData) {
    return interaction.editReply("❌ You are not registered in your group")
  }

  // 🌐 Llamar API con grupo
if (userData.main_id) {
  await fetch(`${API_URL}?action=offline&id=${userData.main_id}&group=${group}`)
}

if (userData.sec_id) {
  await fetch(`${API_URL}?action=offline&id=${userData.sec_id}&group=${group}`)
}

  return interaction.editReply(`🔴 ${userData.name} is now OFFLINE in ${group}`)
}
 
//SETOFFLINE

if (interaction.commandName === "set_offline") {
  const member = interaction.member;

  if (!member.roles.cache.some(role => role.name === "Champion")) {
    return interaction.reply({
      content: "❌ You need the **Champion** role to use this command.",
      ephemeral: true
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
    ephemeral: true
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

  const activeRoles = await getActiveRoles()

  activeRoles[interaction.user.id] = selected

  await saveActiveRoles(activeRoles)

  return interaction.update({
    content: `✅ Active role set to **${selected}**`,
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
 

 if (interaction.isStringSelectMenu() && interaction.customId === "select_offline_group") {
  const group = interaction.values[0];

  if (!GROUP_CONFIG[group]) {
    return interaction.update({
      content: "❌ Invalid group selected.",
      components: []
    });
  }

  const onlineUsers = await getOnlineUsersByGroup(group);

  if (!onlineUsers.length) {
    return interaction.update({
      content: `⚫ No active users in **${group}**`,
      components: []
    });
  }

  const options = onlineUsers.slice(0, 25).map(entry => ({
    label: entry.label.slice(0, 100),
    description: entry.id,
    value: `${group}|${entry.id}`
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

  await fetch(`${API_URL}?action=offline&id=${id}&group=${group}`);

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

  const config = GROUP_CONFIG[group];
  const registeredUsers = await getUsers(
    config.USERS_GIST_ID,
    config.USERS_FILENAME
  );

  if (Object.keys(registeredUsers).length === 0) {
    return interaction.reply("📭 No users registered");
  }

  let msg = `📋 **Registered users in ${group}:**\n\n`;

  for (const uid in registeredUsers) {
    const user = registeredUsers[uid];
    msg += `👤 ${user.name} → Main ID: ${user.main_id}\n`;
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

    const config = GROUP_CONFIG[group];

    // 🔹 Obtener IDs online del gist correcto
    const resOnline = await fetch(
      `https://api.github.com/gists/${config.IDS_GIST_ID}?t=${Date.now()}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Cache-Control": "no-cache"
        }
      }
    );

    if (!resOnline.ok)
      return interaction.editReply("❌ Error fetching online IDs");

    const gistOnline = await resOnline.json();

    // 🔥 AQUÍ usamos el nombre correcto por grupo
    const contentOnline =
      gistOnline.files[config.IDS_FILENAME]?.content || "";

    const onlineIds = contentOnline
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(x => /^\d{16}$/.test(x));

    if (onlineIds.length === 0)
      return interaction.editReply(`⚫ No users online in ${group}`);

    // 🔹 Obtener usuarios registrados del grupo
    const registeredUsers = await getUsers(
      config.USERS_GIST_ID,
      config.USERS_FILENAME
    );

    let msg = `🟢 **Online users in ${group}:**\n\n`;
    let found = false;

    // 🔥 Optimizado (sin doble loop innecesario)
    for (const uid in registeredUsers) {
      const user = registeredUsers[uid];

      const mainId = (user.main_id || "").trim();
      const secId = (user.sec_id || "").trim();

      if (onlineIds.includes(mainId) || onlineIds.includes(secId)) {
        msg += `👤 ${user.name} → ${mainId}\n`;
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

  // 🔍 obtener roles válidos que el usuario tiene
  const userGroups = Object.keys(GROUP_CONFIG).filter(group =>
    member.roles.cache.some(role => role.name === group)
  );

  // ❌ no tiene ningún grupo
  if (userGroups.length === 0) {
    return interaction.reply({
      content: "❌ You don't have any valid reroll roles.",
      ephemeral: true
    });
  }

  // ❌ solo tiene uno → no necesita cambiar
  if (userGroups.length === 1) {
    return interaction.reply({
      content: `⚠️ You only have one role (**${userGroups[0]}**).\nYou need at least 2 roles to switch.`,
      ephemeral: true
    });
  }

  // ✅ construir opciones dinámicamente
  const options = userGroups.map(group => ({
    label: group.replace("_", " "),
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
    ephemeral: true
  });
}


 

if (commandName === "editpanel") {
  try {
    // Verificar si el usuario tiene el rol Champion
    const member = interaction.member; // miembro que ejecuta el comando
    if (!member.roles.cache.some(role => role.name === "Champion")) {
      return interaction.reply({
        content: "❌ You need the **Champion** role to use this command.",
        ephemeral: true
      });
    }

    // ----- Resto del comando aquí -----
    await interaction.reply({
      content: "📝 Please send the **Message ID** of the panel you want to edit:",
      ephemeral: true
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
      return interaction.followUp({ content: "❌ Message not found.", ephemeral: true });
    }

    if (!message.embeds.length) {
      return interaction.followUp({ content: "❌ That message has no embed.", ephemeral: true });
    }

    await interaction.followUp({
      content: "🔢 Now, please send the new **Rarity (1-5)**:",
      ephemeral: true
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
        ephemeral: true
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
      ephemeral: true
    });

  } catch (err) {
    console.error("EDIT PANEL ERROR:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Something went wrong.",
        ephemeral: true
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
