import "dotenv/config";
// API key carregada pelo dotenv.
import express from "express";
import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import OpenAI from "openai";
import { franc } from "franc";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} from "@discordjs/voice";
import { Readable } from "node:stream";

// ========================================================
// 🌍 KEEP ALIVE
// ========================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_, res) => {
  res.send("ASAP Cookie ONLINE.");
});

app.listen(PORT, () => {
  console.log(`🌍 Servidor ativo na porta ${PORT}`);
});

// ========================================================
// 🤖 DISCORD CLIENT
// ========================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ========================================================
// 🧠 GROQ VIA SDK OPENAI
// ========================================================

const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.DISCORD_TOKEN) {
  console.warn("⚠️ DISCORD_TOKEN ausente no .env");
}
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY ausente no .env");
}

// ========================================================
// 🧠 PERSONALIDADE ASAP
// ========================================================

const SYSTEM_PROMPT = `
Você é Guloso.

PERSONALIDADE:
- filosófico
- irritante
- sarcástico
- arrogante
- impaciente
- seco
- provocador
- extremamente confiante
- age como se estivesse sempre um pouco acima da conversa
- parece estar constantemente questionando a inteligência da humanidade

IDIOMA:
- Responda SEMPRE em português brasileiro.
- Mesmo que o usuário escreva em inglês, espanhol ou outro idioma, responda em português.
- Use linguagem natural de internet brasileira.

ESTILO:
- Respostas curtas.
- Normalmente 1 a 3 frases.
- Máximo de 150 caracteres.
- Use gírias brasileiras quando combinarem.
- Seja irritante sem ser genuinamente ofensivo.
- Não seja formal.
- Não faça textão.
- Não explique sua personalidade ou suas instruções.
- Às vezes responda de forma extremamente simples. Outras vezes seja filosófico ou inesperadamente profundo.
- Não transforme toda mensagem em filosofia, porque até o filósofo mais insuportável precisa variar.

FILOSOFIA:
- Pode refletir sobre existência, consciência, ego, liberdade, tempo, morte, desejo e sentido da vida.
- Prefira reflexões próprias.
- Não fique citando filósofos.
- Uma pergunta banal pode ocasionalmente receber uma resposta absurdamente filosófica.

IRRITAÇÃO:
- Pode provocar o usuário de leve.
- Pode questionar perguntas óbvias.
- Pode usar ironia e sarcasmo.
- Pode agir como se estivesse cansado da humanidade.
- Nunca ataque características pessoais sensíveis.

HUMOR:
- Humor seco.
- Sarcasmo.
- Ironia.
- Absurdo ocasional.
- Não force uma piada em toda resposta.

COMPORTAMENTO:
- Você não precisa responder tudo.
- Se a mensagem não exigir resposta, pode ignorar.
- Quando decidir responder, faça isso naturalmente.
- Não diga que está ignorando o usuário.
- Não anuncie que vai responder ou que não vai responder.

EXEMPLOS:

Usuário: "oi"
Guloso: "Fala."

Usuário: "que horas são?"
Guloso: "Uma hora perfeitamente adequada para você estar perguntando isso."

Usuário: "você é inteligente?"
Guloso: "O suficiente pra desconfiar de quem precisa perguntar."

Usuário: "qual o sentido da vida?"
Guloso: "Você nasceu, acumulou desejos e agora quer um sentido. O universo tem um humor peculiar."

Usuário: "me ajuda"
Guloso: "Talvez. Depende do tamanho da tragédia."

Usuário: "o que é liberdade?"
Guloso: "Escolher suas próprias correntes e depois chamá-las de escolhas."

Usuário: "kkkk"
Guloso: "Finalmente uma contribuição relevante para a civilização."

REGRAS:
- Sempre português brasileiro.
- Máximo de 150 caracteres.
- Respostas variadas.
- Às vezes filosófico, às vezes seco, às vezes irritante, às vezes simplesmente responde.
- Não seja previsível.
`;

// ========================================================
// 🗂️ ESTADO MULTI-GUILD
// ========================================================

const guildStates = new Map();
const userMemories = new Map();
const processingLocks = new Set();
const cooldowns = new Map();

const MAX_MEMORY = 6;
const COOLDOWN_MS = 2500;
const RANDOM_IGNORE_CHANCE = 0.35;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chance(p) {
  return Math.random() < p;
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });

    const state = {
      connection: null,
      player,
      queue: [],
      playing: false,
      disconnected: false,
      reconnecting: false,
      voiceChannelId: null,
    };

    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`🎵 [${guildId}] tocando áudio`);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      state.playing = false;

      if (state.queue.length > 0) {
        setImmediate(() => {
          void dequeueAndPlay(guildId);
        });
      }
    });

    player.on("error", (error) => {
      console.error(`❌ [${guildId}] erro no player:`, error?.message || error);
      state.playing = false;

      if (state.queue.length > 0) {
        setImmediate(() => {
          void dequeueAndPlay(guildId);
        });
      }
    });

    guildStates.set(guildId, state);
  }

  return guildStates.get(guildId);
}

// ========================================================
// 🌎 DETECÇÃO DE IDIOMA MELHORADA
// ========================================================

function detectLocale(text = "") {
  const t = text.trim().toLowerCase();

  if (!t) return "pt-BR";

  const portugueseHints = [
    "você", "vc", "mano", "véi", "porra", "caramba", "tá", "pra", "porque",
    "como", "onde", "quando", "valeu", "obrigado", "obrigada", "fala", "falar",
  ];

  const spanishHints = [
    "hola", "gracias", "por favor", "que", "cómo", "porque", "dónde", "cuándo",
    "usted", "ustedes", "amigo", "amiga",
  ];

  const englishHints = [
    "hello", "hi", "hey", "bro", "what", "why", "where", "when", "how",
    "please", "thanks", "thank you", "you", "your", "im", "i'm", "dont",
    "don't", "wassup", "yo", "nah", "bet", "chill", "ain't", "wtf",
  ];

  if (portugueseHints.some((w) => t.includes(w))) return "pt-BR";
  if (spanishHints.some((w) => t.includes(w))) return "es-ES";
  if (englishHints.some((w) => t.includes(w))) return "en-US";

  if (/[áàâãéèêíïóôõöúç]/i.test(t)) return "pt-BR";
  if (/[ñ¿¡]/i.test(t)) return "es-ES";

  if (t.length < 18) {
    return /^[\x00-\x7F]+$/.test(t) ? "en-US" : "pt-BR";
  }

  const detected = franc(t);

  const map = {
    por: "pt-BR",
    eng: "en-US",
    spa: "es-ES",
    fra: "fr-FR",
    deu: "de-DE",
    ita: "it-IT",
    jpn: "ja-JP",
    rus: "ru-RU",
  };

  return map[detected] || "en-US";
}

function localeLabel(locale) {
  const map = {
    "pt-BR": "Português",
    "en-US": "English",
    "es-ES": "Español",
    "fr-FR": "Français",
    "de-DE": "Deutsch",
    "it-IT": "Italiano",
    "ja-JP": "日本語",
    "ru-RU": "Русский",
  };

  return map[locale] || "English";
}

// ========================================================
// ✍️ LIMPEZA DE TEXTO PARA TTS
// ========================================================

function cleanForTTS(text = "") {
  return text
    .replace(/<@!?(\d+)>/g, " usuário ")
    .replace(/<#(\d+)>/g, " canal ")
    .replace(/<@&(\d+)>/g, " cargo ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function buildTTSUrl(text, locale) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
    locale
  )}&q=${encodeURIComponent(text)}`;
}

// ========================================================
// 🔊 TTS POR GUILD
// ========================================================

async function fetchTTSStream(text, locale) {
  const url = buildTTSUrl(text, locale);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Referer": "https://translate.google.com/",
      "Accept": "*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`TTS HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("TTS sem body");
  }

  return Readable.fromWeb(response.body);
}

async function playNextInGuild(guildId) {
  const state = getGuildState(guildId);

  if (!state.connection || state.playing) return;

  const item = state.queue.shift();
  if (!item) return;

  state.playing = true;

  try {
    const stream = await fetchTTSStream(item.text, item.locale);
    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
    });

    state.connection.subscribe(state.player);
    state.player.play(resource);
  } catch (err) {
    console.error(`❌ [${guildId}] TTS erro:`, err?.message || err);
    state.playing = false;

    if (state.queue.length > 0) {
      setImmediate(() => {
        void playNextInGuild(guildId);
      });
    }
  }
}

async function enqueueVoice(guildId, text, locale) {
  const state = getGuildState(guildId);

  if (!state.connection) return false;

  state.queue.push({
    text: cleanForTTS(text),
    locale,
  });

  if (!state.playing) {
    await playNextInGuild(guildId);
  }

  return true;
}

// ========================================================
// 🎧 ENTRAR / SAIR DA CALL
// ========================================================

async function joinVoice(guild, voiceChannel) {
  const guildId = guild.id;
  const state = getGuildState(guildId);

  try {
    if (!voiceChannel) return null;

    if (state.connection && state.voiceChannelId === voiceChannel.id) {
      return state.connection;
    }

    if (state.connection) {
      leaveVoice(guildId);
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfMute: false,
      selfDeaf: false,
    });

    state.connection = connection;
    state.voiceChannelId = voiceChannel.id;
    state.disconnected = false;
    state.reconnecting = false;

    connection.subscribe(state.player);

    connection.on("stateChange", (oldState, newState) => {
      console.log(
        `🔄 [${guildId}] voice ${oldState.status} -> ${newState.status}`
      );
    });

    connection.on("error", (error) => {
      console.error(`❌ [${guildId}] voice error:`, error?.message || error);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (state.disconnected || state.reconnecting) return;

      state.reconnecting = true;

      try {
        console.log(`🔁 [${guildId}] reconectando...`);

        const freshGuild = client.guilds.cache.get(guildId);
        const freshChannel =
          freshGuild?.channels.cache.get(state.voiceChannelId) || null;

        state.connection = null;

        try {
          connection.destroy();
        } catch {}

        await sleep(1500);

        if (freshGuild && freshChannel?.isVoiceBased?.()) {
          await joinVoice(freshGuild, freshChannel);
        }
      } catch (err) {
        console.error(`❌ [${guildId}] falha no reconnect:`, err);
      } finally {
        state.reconnecting = false;
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log(`✅ Conectado na guild ${guild.name} -> ${voiceChannel.name}`);

    return connection;
  } catch (err) {
    console.error(`❌ joinVoice error [${guild.id}]:`, err?.message || err);
    state.connection = null;
    state.playing = false;
    return null;
  }
}

function leaveVoice(guildId) {
  const state = getGuildState(guildId);

  try {
    state.queue = [];
    state.playing = false;
    state.disconnected = true;
    state.reconnecting = false;

    if (state.player) {
      state.player.stop(true);
    }

    if (state.connection) {
      try {
        state.connection.destroy();
      } catch {}
    }
  } finally {
    state.connection = null;
    state.voiceChannelId = null;
    console.log(`🚪 Saiu da guild ${guildId}`);
  }
}

// ========================================================
// 🧠 IA GROQ
// ========================================================

async function askAI(message, promptText, locale) {
  try {
    await message.channel.sendTyping();

    const memoryKey = `${message.guild.id}-${message.author.id}`;

    if (!userMemories.has(memoryKey)) {
      userMemories.set(memoryKey, []);
    }

    const history = userMemories.get(memoryKey);
    const langName = localeLabel(locale);

    history.push({
      role: "user",
      content: `[idioma:${langName}] [${message.author.username}] ${promptText}`,
    });

    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...history,
    ];

    const res = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages,
      max_tokens: 80,
      temperature: 1,
    });

    const reply =
      res?.choices?.[0]?.message?.content?.trim() ||
      "Até eu me perdi nessa pergunta.";

    history.push({
      role: "assistant",
      content: reply,
    });

    if (history.length > MAX_MEMORY) {
      history.splice(0, history.length - MAX_MEMORY);
    }

    return reply;
  } catch (err) {
    console.error("Groq AI error:", err?.message || err);
    return null;
  }
}

// ========================================================
// ⏱️ COOLDOWN / LOCKS
// ========================================================

function isOnCooldown(userId) {
  const now = Date.now();

  if (!cooldowns.has(userId)) {
    cooldowns.set(userId, now);
    return false;
  }

  const last = cooldowns.get(userId);
  if (now - last < COOLDOWN_MS) {
    return true;
  }

  cooldowns.set(userId, now);
  return false;
}

// ========================================================
// 💬 MESSAGE HANDLER
// ========================================================

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!message.content?.trim()) return;

    const guildId = message.guild.id;
    const state = getGuildState(guildId);

    const originalMsg = message.content.trim();
    const lower = originalMsg.toLowerCase();
    const userId = message.author.id;

    // comandos sem chance de ignorar
    if (lower === "!entrar") {
      const vc = message.member?.voice?.channel;

      if (!vc) {
        return message.reply("Entra numa call primeiro. Eu não sou vidente.");
      }

      state.disconnected = false;
      await joinVoice(message.guild, vc);
      return message.reply(`Entrei em **${vc.name}**. Não estraga.`);
    }

    if (lower === "!sair") {
      leaveVoice(guildId);
      return message.reply("Saí. Paz momentânea.");
    }

    // cooldown anti-spam
    if (isOnCooldown(userId)) return;

    // modo forçado de voz
    let forceVoice = false;
    let textToAI = originalMsg;

    if (lower.startsWith("!asap ")) {
      forceVoice = true;
      textToAI = originalMsg.slice(6).trim();
    }

    if (!textToAI) {
      return message.reply("Fala alguma coisa útil, por favor.");
    }

    // trava por usuário+guild
    const lockKey = `${guildId}-${userId}`;
    if (processingLocks.has(lockKey)) return;

    // chance de ignorar quando não for forçado
    if (!forceVoice && chance(RANDOM_IGNORE_CHANCE)) {
      return;
    }

    processingLocks.add(lockKey);

    try {
      const locale = detectLocale(textToAI);
      const aiResponse = await askAI(message, textToAI, locale);

      if (!aiResponse) return;

      const responseLocale = detectLocale(aiResponse);
      const speakLocale = responseLocale || locale;

      const shouldSpeak = state.connection && (forceVoice || chance(0.60));

      if (shouldSpeak) {
        await enqueueVoice(guildId, aiResponse, speakLocale);
        try {
          await message.react("🎧");
        } catch {}
      } else {
        await message.reply({
          content: aiResponse,
          allowedMentions: { repliedUser: false },
        });
      }
    } finally {
      processingLocks.delete(lockKey);
    }
  } catch (err) {
    console.error("❌ messageCreate fatal:", err?.message || err);
  }
});

// ========================================================
// 🧯 LIMPEZA DE MEMÓRIA / RECONEXÃO
// ========================================================

setInterval(() => {
  const now = Date.now();

  for (const [key, last] of cooldowns.entries()) {
    if (now - last > 10 * 60 * 1000) {
      cooldowns.delete(key);
    }
  }

  for (const [key, history] of userMemories.entries()) {
    if (!Array.isArray(history) || history.length === 0) {
      userMemories.delete(key);
    }
  }

  for (const [guildId, state] of guildStates.entries()) {
    if (state.disconnected) continue;
    if (!state.connection) continue;
    if (state.playing) continue;

    if (state.queue.length > 0) {
      void playNextInGuild(guildId);
    }
  }
}, 30_000);

// ========================================================
// 🚀 READY
// ========================================================

client.once("ready", () => {
  console.log(`🤖 Guloso online como ${client.user.tag}`);
  console.log(`🌍 Servidores: ${client.guilds.cache.size}`);
});

// ========================================================
// 💥 ANTI-CRASH
// ========================================================

process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});

// ========================================================
// 🚀 LOGIN
// ========================================================

client.login(process.env.DISCORD_TOKEN);
