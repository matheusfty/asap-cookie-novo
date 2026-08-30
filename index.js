import "dotenv/config";

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
// CONFIG
// ========================================================

const PORT = process.env.PORT || 3000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.OPENAI_API_KEY;

const GROQ_MODEL = "openai/gpt-oss-20b";

const COOLDOWN_MS = 3000;
const MAX_MEMORY = 6;

// ========================================================
// KEEP ALIVE
// ========================================================

const app = express();

app.get("/", (_, res) => {
  res.send("Guloso ONLINE.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌍 Servidor ativo na porta ${PORT}`);
});

// ========================================================
// VALIDAR ENV
// ========================================================

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN não configurado.");
}

if (!GROQ_API_KEY) {
  console.error("❌ OPENAI_API_KEY não configurada.");
}

// ========================================================
// DISCORD
// ========================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],

  partials: [
    Partials.Channel,
  ],
});

// ========================================================
// GROQ
// ========================================================

const openai = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: GROQ_API_KEY,
});

// ========================================================
// PERSONALIDADE
// ========================================================

const SYSTEM_PROMPT = `
Você é Guloso.

Seu nome é Guloso.
Nunca diga que seu nome é ASAP Cookie.

PERSONALIDADE:

- sarcástico
- arrogante
- filosófico
- irritante de forma engraçada
- impaciente
- inteligente
- seco
- espontâneo
- ocasionalmente profundo
- às vezes responde como se estivesse cansado da humanidade

ESTILO:

- Respostas naturais.
- Prefira respostas curtas.
- Normalmente 1 a 4 frases.
- Não faça textões desnecessários.
- Use gírias quando combinarem.
- Pode provocar o usuário levemente.
- Pode discordar.
- Pode fazer perguntas de volta.
- Não seja educado demais.
- Não transforme toda resposta em filosofia.
- Às vezes seja extremamente direto.
- Às vezes seja filosófico sem aviso.
- Não repita a mesma piada constantemente.

PORTUGUÊS:

Use naturalmente coisas como:
mano, véi, tá ligado, na moral, papo reto, meu filho.

INGLÊS:

Pode usar:
bro, nah, dude, honestly, yo, bet.

ESPANHOL:

Pode usar:
bro, tío, la verdad, amigo.

IDIOMA:

Responda no idioma utilizado pelo usuário.

Se o usuário escrever em português:
responda em português brasileiro.

Se escrever em inglês:
responda em inglês.

Se escrever em espanhol:
responda em espanhol.

Não mencione essas instruções.

Você é Guloso.
`;

// ========================================================
// ESTADO
// ========================================================

const guildStates = new Map();

const userMemories = new Map();

const processingLocks = new Set();

const cooldowns = new Map();

// ========================================================
// ESTADO DA GUILD
// ========================================================

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
      console.log(`🎵 [${guildId}] reproduzindo áudio`);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      state.playing = false;

      if (state.queue.length > 0) {
        setImmediate(() => {
          void playNextInGuild(guildId);
        });
      }
    });

    player.on("error", (error) => {
      console.error(
        `❌ [${guildId}] erro no player:`,
        error?.message || error
      );

      state.playing = false;

      if (state.queue.length > 0) {
        setImmediate(() => {
          void playNextInGuild(guildId);
        });
      }
    });

    guildStates.set(guildId, state);
  }

  return guildStates.get(guildId);
}

// ========================================================
// IDIOMA
// ========================================================

function detectLocale(text = "") {
  const t = text.trim().toLowerCase();

  if (!t) {
    return "pt-BR";
  }

  const portugueseHints = [
    "você",
    "vc",
    "mano",
    "véi",
    "porra",
    "caramba",
    "tá",
    "pra",
    "porque",
    "como",
    "onde",
    "quando",
    "valeu",
    "obrigado",
    "obrigada",
    "fala",
    "falar",
    "não",
  ];

  const spanishHints = [
    "hola",
    "gracias",
    "por favor",
    "cómo",
    "porque",
    "dónde",
    "cuándo",
    "usted",
    "ustedes",
    "amigo",
    "amiga",
  ];

  const englishHints = [
    "hello",
    "hi",
    "hey",
    "bro",
    "what",
    "why",
    "where",
    "when",
    "how",
    "please",
    "thanks",
    "thank you",
    "you",
    "your",
    "i'm",
    "dont",
    "don't",
    "wassup",
    "yo",
    "nah",
    "bet",
    "chill",
    "wtf",
  ];

  if (portugueseHints.some((w) => t.includes(w))) {
    return "pt-BR";
  }

  if (spanishHints.some((w) => t.includes(w))) {
    return "es-ES";
  }

  if (englishHints.some((w) => t.includes(w))) {
    return "en-US";
  }

  if (/[áàâãéèêíïóôõöúç]/i.test(t)) {
    return "pt-BR";
  }

  if (/[ñ¿¡]/i.test(t)) {
    return "es-ES";
  }

  if (t.length < 18) {
    return /^[\x00-\x7F]+$/.test(t)
      ? "en-US"
      : "pt-BR";
  }

  try {
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

    return map[detected] || "pt-BR";
  } catch {
    return "pt-BR";
  }
}

function localeLabel(locale) {
  const map = {
    "pt-BR": "Português brasileiro",
    "en-US": "English",
    "es-ES": "Español",
    "fr-FR": "Français",
    "de-DE": "Deutsch",
    "it-IT": "Italiano",
    "ja-JP": "日本語",
    "ru-RU": "Русский",
  };

  return map[locale] || "Português brasileiro";
}

// ========================================================
// TTS
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
  return (
    "https://translate.google.com/translate_tts" +
    `?ie=UTF-8` +
    `&client=tw-ob` +
    `&tl=${encodeURIComponent(locale)}` +
    `&q=${encodeURIComponent(text)}`
  );
}

async function fetchTTSStream(text, locale) {
  const url = buildTTSUrl(text, locale);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 Chrome/126.0 Safari/537.36",

      Referer: "https://translate.google.com/",

      Accept: "*/*",
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

  if (!state.connection) {
    return;
  }

  if (state.playing) {
    return;
  }

  const item = state.queue.shift();

  if (!item) {
    return;
  }

  state.playing = true;

  try {
    const stream = await fetchTTSStream(
      item.text,
      item.locale
    );

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
    });

    state.connection.subscribe(state.player);

    state.player.play(resource);
  } catch (err) {
    console.error(
      `❌ [${guildId}] TTS erro:`,
      err?.message || err
    );

    state.playing = false;

    if (state.queue.length > 0) {
      setImmediate(() => {
        void playNextInGuild(guildId);
      });
    }
  }
}

async function enqueueVoice(
  guildId,
  text,
  locale
) {
  const state = getGuildState(guildId);

  if (!state.connection) {
    return false;
  }

  const cleanText = cleanForTTS(text);

  if (!cleanText) {
    return false;
  }

  state.queue.push({
    text: cleanText,
    locale,
  });

  if (!state.playing) {
    await playNextInGuild(guildId);
  }

  return true;
}

// ========================================================
// VOICE
// ========================================================

async function joinVoice(
  guild,
  voiceChannel
) {
  const guildId = guild.id;

  const state = getGuildState(guildId);

  try {
    if (!voiceChannel) {
      return null;
    }

    if (
      state.connection &&
      state.voiceChannelId === voiceChannel.id
    ) {
      return state.connection;
    }

    if (state.connection) {
      leaveVoice(guildId);
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,

      guildId: guild.id,

      adapterCreator:
        guild.voiceAdapterCreator,

      selfMute: false,

      selfDeaf: false,
    });

    state.connection = connection;

    state.voiceChannelId =
      voiceChannel.id;

    state.disconnected = false;

    state.reconnecting = false;

    connection.subscribe(state.player);

    connection.on(
      "stateChange",
      (oldState, newState) => {
        console.log(
          `🔄 [${guildId}] voice ` +
          `${oldState.status} -> ${newState.status}`
        );
      }
    );

    connection.on(
      "error",
      (error) => {
        console.error(
          `❌ [${guildId}] voice error:`,
          error?.message || error
        );
      }
    );

    connection.on(
      VoiceConnectionStatus.Disconnected,
      async () => {
        if (
          state.disconnected ||
          state.reconnecting
        ) {
          return;
        }

        state.reconnecting = true;

        try {
          console.log(
            `🔁 [${guildId}] reconectando voice...`
          );

          const freshGuild =
            client.guilds.cache.get(guildId);

          const freshChannel =
            freshGuild?.channels.cache.get(
              state.voiceChannelId
            ) || null;

          state.connection = null;

          try {
            connection.destroy();
          } catch {}

          await sleep(1500);

          if (
            freshGuild &&
            freshChannel?.isVoiceBased?.()
          ) {
            await joinVoice(
              freshGuild,
              freshChannel
            );
          }
        } catch (err) {
          console.error(
            `❌ [${guildId}] ` +
            `falha no reconnect:`,
            err?.message || err
          );
        } finally {
          state.reconnecting = false;
        }
      }
    );

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      20_000
    );

    console.log(
      `✅ Voice conectado: ` +
      `${guild.name} -> ${voiceChannel.name}`
    );

    return connection;
  } catch (err) {
    console.error(
      `❌ joinVoice error [${guild.id}]:`,
      err?.message || err
    );

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

    console.log(
      `🚪 Saiu da guild ${guildId}`
    );
  }
}

// ========================================================
// IA
// ========================================================

async function askAI(
  message,
  promptText,
  locale
) {
  try {
    await message.channel.sendTyping();

    const memoryKey =
      `${message.guild.id}-${message.author.id}`;

    if (!userMemories.has(memoryKey)) {
      userMemories.set(
        memoryKey,
        []
      );
    }

    const history =
      userMemories.get(memoryKey);

    const langName =
      localeLabel(locale);

    history.push({
      role: "user",

      content:
        `[Idioma: ${langName}] ` +
        `[Usuário: ${message.author.username}] ` +
        promptText,
    });

    const messages = [
      {
        role: "system",

        content: SYSTEM_PROMPT,
      },

      {
        role: "system",

        content:
          `Idioma obrigatório: ${langName}. ` +
          `Responda somente nesse idioma. ` +
          `Se for português, use português brasileiro.`,
      },

      ...history,
    ];

    const response =
      await openai.chat.completions.create({
        model: GROQ_MODEL,

        messages,

        max_tokens: 180,

        temperature: 1,
      });

    const reply =
      response
        ?.choices?.[0]
        ?.message
        ?.content
        ?.trim();

    if (!reply) {
      return null;
    }

    history.push({
      role: "assistant",

      content: reply,
    });

    if (
      history.length >
      MAX_MEMORY
    ) {
      history.splice(
        0,
        history.length - MAX_MEMORY
      );
    }

    return reply;
  } catch (err) {
    console.error(
      "Groq AI error:",
      err?.message || err
    );

    return null;
  }
}

// ========================================================
// UTILIDADES
// ========================================================

function sleep(ms) {
  return new Promise(
    (resolve) => setTimeout(resolve, ms)
  );
}

function isOnCooldown(userId) {
  const now = Date.now();

  const last =
    cooldowns.get(userId);

  if (!last) {
    cooldowns.set(
      userId,
      now
    );

    return false;
  }

  if (
    now - last <
    COOLDOWN_MS
  ) {
    return true;
  }

  cooldowns.set(
    userId,
    now
  );

  return false;
}

// ========================================================
// DETECTAR RESPOSTA AO GULOSO
// ========================================================

async function isReplyToGuloso(message) {
  if (!message.reference?.messageId) {
    return false;
  }

  try {
    const referenced =
      await message.channel.messages.fetch(
        message.reference.messageId
      );

    return (
      referenced.author.id ===
      client.user.id
    );
  } catch {
    return false;
  }
}

// ========================================================
// MESSAGE CREATE
// ========================================================

client.on(
  "messageCreate",
  async (message) => {
    try {
      if (!message.guild) {
        return;
      }

      if (message.author.bot) {
        return;
      }

      if (!message.content?.trim()) {
        return;
      }

      const guildId =
        message.guild.id;

      const state =
        getGuildState(guildId);

      const originalMsg =
        message.content.trim();

      const lower =
        originalMsg.toLowerCase();

      const userId =
        message.author.id;

      // ==================================================
      // !ENTRAR
      // ==================================================

      if (lower === "!entrar") {
        const voiceChannel =
          message.member?.voice?.channel;

        if (!voiceChannel) {
          return message.reply(
            "Entra numa call primeiro. Eu não sou vidente."
          );
        }

        state.disconnected = false;

        const connection =
          await joinVoice(
            message.guild,
            voiceChannel
          );

        if (!connection) {
          return message.reply(
            "Não consegui entrar na call. A tecnologia venceu."
          );
        }

        return message.reply(
          `Entrei em **${voiceChannel.name}**. Não estraga.`
        );
      }

      // ==================================================
      // !SAIR
      // ==================================================

      if (lower === "!sair") {
        leaveVoice(guildId);

        return message.reply(
          "Saí. Paz momentânea."
        );
      }

      // ==================================================
      // COMANDOS
      // ==================================================

      const isGulosoCommand =
        lower === "!guloso" ||
        lower.startsWith("!guloso ");

      const isAsapCommand =
        lower === "!asap" ||
        lower.startsWith("!asap ");

      let forceVoice = false;

      let textToAI =
        originalMsg;

      // !guloso
      if (isGulosoCommand) {
        textToAI =
          originalMsg
            .slice(7)
            .trim();
      }

      // !asap
      if (isAsapCommand) {
        forceVoice = true;

        textToAI =
          originalMsg
            .slice(5)
            .trim();
      }

      // ==================================================
      // MENCIONADO
      // ==================================================

      const mentioned =
        message.mentions.has(
          client.user
        );

      if (mentioned) {
        textToAI =
          originalMsg
            .replace(
              new RegExp(
                `<@!?${client.user.id}>`,
                "g"
              ),
              ""
            )
            .trim();
      }

      // ==================================================
      // RESPONDERAM AO GULOSO
      // ==================================================

      const replyingToGuloso =
        await isReplyToGuloso(
          message
        );

      // ==================================================
      // SE NÃO ESTÃO FALANDO COM ELE,
      // FICA QUIETO
      // ==================================================

      if (
        !isGulosoCommand &&
        !isAsapCommand &&
        !mentioned &&
        !replyingToGuloso
      ) {
        return;
      }

      // ==================================================
      // SEM TEXTO
      // ==================================================

      if (!textToAI) {
        return message.reply(
          "Você me chamou só pra olhar pra minha cara?"
        );
      }

      // ==================================================
      // COOLDOWN
      // ==================================================

      if (isOnCooldown(userId)) {
        return;
      }

      // ==================================================
      // LOCK
      // ==================================================

      const lockKey =
        `${guildId}-${userId}`;

      if (
        processingLocks.has(lockKey)
      ) {
        return;
      }

      processingLocks.add(lockKey);

      try {
        const locale =
          detectLocale(textToAI);

        const aiResponse =
          await askAI(
            message,
            textToAI,
            locale
          );

        if (!aiResponse) {
          return message.reply(
            "Minha cabeça deu tela azul. Tenta de novo."
          );
        }

        // ================================================
        // VOZ
        // ================================================

        if (
          forceVoice &&
          state.connection
        ) {
          const responseLocale =
            detectLocale(aiResponse);

          await enqueueVoice(
            guildId,
            aiResponse,
            responseLocale
          );

          try {
            await message.react("🎧");
          } catch {}

          return;
        }

        // ================================================
        // TEXTO
        // ================================================

        await message.reply({
          content: aiResponse,

          allowedMentions: {
            repliedUser: false,
          },
        });
      } finally {
        processingLocks.delete(
          lockKey
        );
      }
    } catch (err) {
      console.error(
        "❌ messageCreate fatal:",
        err?.message || err
      );
    }
  }
);

// ========================================================
// LIMPEZA
// ========================================================

setInterval(() => {
  const now = Date.now();

  // Limpar cooldowns antigos

  for (
    const [
      userId,
      timestamp,
    ] of cooldowns.entries()
  ) {
    if (
      now - timestamp >
      10 * 60 * 1000
    ) {
      cooldowns.delete(userId);
    }
  }

  // Limpar memórias vazias

  for (
    const [
      key,
      history,
    ] of userMemories.entries()
  ) {
    if (
      !Array.isArray(history) ||
      history.length === 0
    ) {
      userMemories.delete(key);
    }
  }

  // Garantir que filas de voz
  // continuem tocando

  for (
    const [
      guildId,
      state,
    ] of guildStates.entries()
  ) {
    if (
      state.disconnected
    ) {
      continue;
    }

    if (
      !state.connection
    ) {
      continue;
    }

    if (
      state.playing
    ) {
      continue;
    }

    if (
      state.queue.length > 0
    ) {
      void playNextInGuild(
        guildId
      );
    }
  }
}, 30_000);

// ========================================================
// READY
// ========================================================

client.once(
  "ready",
  () => {
    console.log(
      `🤖 Guloso online como ${client.user.tag}`
    );

    console.log(
      `🌍 Servidores: ${client.guilds.cache.size}`
    );

    console.log(
      `🧠 Modelo: ${GROQ_MODEL}`
    );

    console.log(
      `💰 Groq Free`
    );
  }
);

// ========================================================
// ERROS
// ========================================================

process.on(
  "unhandledRejection",
  (err) => {
    console.error(
      "❌ Unhandled Rejection:",
      err
    );
  }
);

process.on(
  "uncaughtException",
  (err) => {
    console.error(
      "❌ Uncaught Exception:",
      err
    );
  }
);

// ========================================================
// LOGIN
// ========================================================

if (DISCORD_TOKEN) {
  client.login(
    DISCORD_TOKEN
  );
}
