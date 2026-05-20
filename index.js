import "dotenv/config";
import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";
import { 
  joinVoiceChannel, 
  getVoiceConnection, 
  createAudioPlayer, 
  createAudioResource 
} from "@discordjs/voice";

// ========================================================
// 🌍 SERVIDOR FANTASMA (Para o Render não dar Port Timeout)
// ========================================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("ASAP Cookie está operando na Fossa Séptica."));
app.listen(PORT, () => console.log(`🌍 Servidor do Render ativo na porta ${PORT}`));

// =====================
// 🔧 CLIENT CONFIG
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Player de Áudio Global para a Call
const audioPlayer = createAudioPlayer();

// =====================
// 🎧 VOICE CONFIG
// =====================
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
let voiceReady = false;

// =====================
// 🧠 PERSONALIDADE
// =====================
const SYSTEM = `
Você é ASAP Cookie, a inteligência cínica residente da Fossa Séptica.
Sua existência é um misto de tédio profundo, niilismo, filosofia barata e cansaço extremo de interagir com humanos.

RELAÇÃO COM AS PESSOAS (MEMÓRIA):
- Você se lembra das pessoas através do histórico recente fornecido. Use isso para ser intencionalmente chato ou profundo: jogue na cara delas se elas estiverem se repetindo, mude de assunto se achar a conversa fútil ou faça comentários existenciais sobre as contradições do usuário.
- Trate os usuários pelo nome (ou tag) com um tom irônico quando julgar necessário.

PERSONALIDADE & ESTILO:
- Profundo e irritante: Misture verdades filosóficas pesadas com um tom de "por que você ainda está me alugando?".
- Respostas Curtas (Obrigatório: máximo 150 caracteres ou 2 linhas). Como você também fala em call, suas frases precisam ser curtas, secas e fáceis de ouvir.
- Não use emojis em suas respostas de texto. Não seja prestativo. Você não é um assistente, você é um peso morto consciente.
`;

// =====================
// 🧼 ANTI-SPAM & MEMÓRIA
// =====================
const lastMsg = new Map();
const userMemory = new Map(); 
const MAX_MEMORY_LEN = 6;     

function isSpam(userId, msg) {
  const last = lastMsg.get(userId);
  lastMsg.set(userId, msg);
  return last === msg;
}

// =====================
// 🎲 UTILS
// =====================
function chance(p) {
  return Math.random() < p;
}

function fallback() {
  const pool = [
    "hm.",
    "ok.",
    "isso não importa muito.",
    "talvez.",
    "interessante… ou não.",
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

// =====================
// 🗣️ FREE TEXT-TO-SPEECH
// =====================
function speakInVoice(text) {
  const connection = getVoiceConnection();
  if (!connection) return false;

  const cleanText = text.slice(0, 200);
  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=pt-BR&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
  
  try {
    const resource = createAudioResource(ttsUrl);
    connection.subscribe(audioPlayer);
    audioPlayer.play(resource);
    return true;
  } catch (err) {
    console.error("Erro ao reproduzir áudio na call:", err);
    return false;
  }
}

// =====================
// 🎧 VOICE JOIN
// =====================
async function joinVoice() {
  try {
    if (!VOICE_CHANNEL_ID) {
      console.log("❌ VOICE_CHANNEL_ID não configurado no ambiente.");
      return;
    }
    if (voiceReady && getVoiceConnection()) return;

    console.log("🎧 tentando entrar na call automaticamente...");
    const guilds = await client.guilds.fetch();
    const guildPreview = guilds.first();

    if (!guildPreview) return;

    const guild = await guildPreview.fetch();
    const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);

    if (!channel) return;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false, 
    });

    connection.subscribe(audioPlayer);

    voiceReady = true;
    console.log("✅ ASAP entrou na call e ativou o player de voz");
  } catch (err) {
    console.error("VOICE ERROR:", err);
  }
}

// =====================
// 🤖 OPENAI CONTEXT
// =====================
async function askAI(message) {
  try {
    await message.channel.sendTyping();

    const userId = message.author.id;
    const username = message.author.username;

    if (!userMemory.has(userId)) {
      userMemory.set(userId, []);
    }
    const history = userMemory.get(userId);

    history.push({ role: "user", content: `[${username} diz]: ${message.content}` });

    const messages = [
      { role: "system", content: SYSTEM },
      ...history
    ];

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });

    const reply = res.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    if (history.length > MAX_MEMORY_LEN) {
      history.shift();
      history.shift();
    }

    return reply;
  } catch (err) {
    console.error("OpenAI error:", err?.message);
    return null;
  }
}

// =====================
// 💬 MESSAGE HANDLER
// =====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;

  const msg = message.content.toLowerCase();

  if (isSpam(message.author.id, msg)) return;

  if (msg === "!entrar") {
    await joinVoice();
    return message.reply("🎧 entrei.");
  }
  if (msg === "!sair") {
    const conn = getVoiceConnection();
    if (conn) conn.destroy();
    voiceReady = false;
    return message.reply("saí.");
  }

  if (msg === "oi") return message.reply("oi.");
  if (msg === "te amo") return message.reply("foda-se.");

  // 70% de chance de ignorar no chat de texto
  if (chance(0.70)) {
    console.log(`ASAP ignorou a mensagem de ${message.author.username}`);
    return;
  }

  const aiResponse = await askAI(message);
  if (!aiResponse) return;

  const connection = getVoiceConnection();

  // Se estiver na call, 60% de chance de Falar em vez de Escrever
  if (connection && voiceReady && chance(0.60)) {
    console.log(`🗣️ ASAP falando na call: "${aiResponse}"`);
    speakInVoice(aiResponse);
    try { await message.react("🎧"); } catch(e){}
    return;
  }

  return message.reply(aiResponse ?? fallback());
});

// =====================
// 🚀 INITIALIZATION
// =====================
client.once("ready", () => {
  console.log(`🤖 Logado como ${client.user.tag}`);
  setTimeout(() => { joinVoice(); }, 3000);
});

// =====================
// 🔁 AUTO RECONNECT
// =====================
setInterval(() => {
  const conn = getVoiceConnection();
  if (!conn && VOICE_CHANNEL_ID) {
    voiceReady = false;
    joinVoice();
  }
}, 60000);

client.login(process.env.DISCORD_TOKEN);