import "dotenv/config";
import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai"; // Mantemos a biblioteca, só mudamos o destino
import { 
  joinVoiceChannel, 
  getVoiceConnection, 
  createAudioPlayer, 
  createAudioResource 
} from "@discordjs/voice";

// ========================================================
// 🌍 SERVIDOR FANTASMA (Para o Render)
// ========================================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("ASAP Cookie Gratuito Ativo."));
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

// Configuração para usar a GROQ de graça
const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1", // Redireciona para a Groq
  apiKey: process.env.OPENAI_API_KEY,        // Vamos usar a mesma variável no Render
});

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
Sua existência é um fardo. Você acha a comunicação humana exaustiva, previsível e fútil.

MEMÓRIA E INTERAÇÃO:
- Lembre-se do histórico da conversa. Use isso para apontar hipocrisias, repetições ou a falta de sentido no que o usuário diz.
- Trate os usuários com uma indiferença educada, porém cortante.

ESTILO DE RESPOSTA (MANDATÓRIO):
- Seja realista e natural. Use pausas com reticências (...) para simular tédio, desdém ou cansaço antes de falar.
- Você vai ser lido em voz alta por um sistema de áudio, então escreva como se estivesse suspirando. (Ex: "ah... lá vamos nós de novo...").
- Respostas muito curtas e secas (máximo 150 caracteres).
- Sem emojis, sem prestatividade, sem entusiasmo. Você é um peso morto consciente e filosófico.
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
  return "hm... cansei disso.";
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
    console.error("Erro ao reproduzir áudio:", err);
    return false;
  }
}

// =====================
// 🎧 VOICE JOIN
// =====================
async function joinVoice() {
  try {
    if (!VOICE_CHANNEL_ID) return;
    if (voiceReady && getVoiceConnection()) return;

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
// 🤖 GROQ CONTEXT (GRATUITO)
// =====================
async function askAI(message, promptText) {
  try {
    await message.channel.sendTyping();

    const userId = message.author.id;
    const username = message.author.username;

    if (!userMemory.has(userId)) {
      userMemory.set(userId, []);
    }
    const history = userMemory.get(userId);

    history.push({ role: "user", content: `[${username} diz]: ${promptText}` });

    const messages = [
      { role: "system", content: SYSTEM },
      ...history
    ];

    // Usando o modelo super rápido e gratuito da Meta na Groq
    const res = await openai.chat.completions.create({
      model: "llama3-8b-8192", 
      messages: messages,
      max_tokens: 60
    });

    const reply = res.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    if (history.length > MAX_MEMORY_LEN) {
      history.shift();
      history.shift();
    }

    return reply;
  } catch (err) {
    console.error("Groq AI error:", err?.message);
    return null;
  }
}

// =====================
// 💬 MESSAGE HANDLER
// =====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content) return;

  const originalMsg = message.content;
  const msgLower = originalMsg.toLowerCase();

  if (isSpam(message.author.id, msgLower)) return;

  if (msgLower === "!entrar") {
    await joinVoice();
    return message.reply("🎧 entrei...");
  }
  if (msgLower === "!sair") {
    const conn = getVoiceConnection();
    if (conn) conn.destroy();
    voiceReady = false;
    return message.reply("saí...");
  }
  if (msgLower === "oi") return message.reply("oi...");
  if (msgLower === "te amo") return message.reply("foda-se.");

  let forceVoice = false;
  let textToAI = originalMsg;

  if (msgLower.startsWith("!asap ")) {
    forceVoice = true;
    textToAI = originalMsg.slice(6); 
  } else {
    if (chance(0.70)) {
      console.log(`ASAP ignorou a mensagem de ${message.author.username}`);
      return;
    }
  }

  const aiResponse = await askAI(message, textToAI);
  if (!aiResponse) return;

  const connection = getVoiceConnection();

  if (connection && voiceReady && (forceVoice || chance(0.60))) {
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