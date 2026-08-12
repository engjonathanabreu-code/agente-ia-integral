import OpenAI, { toFile } from "openai";


function getOpenAIClient() {
  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY não configurada."
    );
  }

  return new OpenAI({
    apiKey,
  });
}


function isAudioAttachment(
  attachment
) {
  const extension =
    String(
      attachment?.extension ||
      ""
    )
      .toLowerCase()
      .replace(".", "");

  const contentType =
    String(
      attachment?.content_type ||
      attachment?.file_type ||
      attachment?.meta?.content_type ||
      ""
    ).toLowerCase();


  const audioExtensions = [
    "mp3",
    "mp4",
    "mpeg",
    "mpga",
    "m4a",
    "wav",
    "webm",
    "ogg",
    "opus",
    "aac",
  ];


  return (
    contentType.startsWith(
      "audio/"
    ) ||
    audioExtensions.includes(
      extension
    )
  );
}


function chooseFilename(
  attachment
) {
  const extension =
    String(
      attachment?.extension ||
      "ogg"
    )
      .replace(".", "")
      .toLowerCase();

  return `audio-cliente.${extension}`;
}


export function getAudioAttachment(
  payload
) {
  const attachments =
    Array.isArray(
      payload?.attachments
    )
      ? payload.attachments
      : [];


  return (
    attachments.find(
      isAudioAttachment
    ) ||
    null
  );
}


export async function transcriptionFromPayload(
  payload
) {
  const audio =
    getAudioAttachment(
      payload
    );


  if (!audio) {
    return null;
  }


  /*
  Algumas versões do Chatwoot
  já podem fornecer transcrição.
  Se houver, reutilizamos.
  */

  const existing =
    String(
      audio?.transcribed_text ||
      ""
    ).trim();


  if (existing) {
    return existing;
  }


  const audioUrl =
    audio?.data_url;


  if (!audioUrl) {
    throw new Error(
      "Áudio recebido sem data_url."
    );
  }


  const response =
    await fetch(
      audioUrl
    );


  if (!response.ok) {
    throw new Error(
      `Não foi possível baixar o áudio do Chatwoot. HTTP ${response.status}`
    );
  }


  const arrayBuffer =
    await response.arrayBuffer();


  const buffer =
    Buffer.from(
      arrayBuffer
    );


  const filename =
    chooseFilename(
      audio
    );


  const client =
    getOpenAIClient();


  const transcription =
    await client.audio.transcriptions.create({
      file:
        await toFile(
          buffer,
          filename
        ),

      model:
        process.env.OPENAI_TRANSCRIPTION_MODEL ||
        "gpt-4o-mini-transcribe",

      language:
        "pt",
    });


  return String(
    transcription?.text ||
    ""
  ).trim();
}
