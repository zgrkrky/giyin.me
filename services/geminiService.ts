/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality, SafetySetting, HarmCategory, HarmBlockThreshold } from "@google/genai";

// Backend adresi: .env'de VITE_API_BASE_URL varsa onu kullan, yoksa localhost:3001
const BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//localhost:3001`
    : 'http://localhost:3001');

const fileToPart = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
};

const dataUrlToParts = (dataUrl: string) => {
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    return { mimeType: mimeMatch[1], data: arr[1] };
}

const dataUrlToPart = (dataUrl: string) => {
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
}

const handleApiResponse = (response: GenerateContentResponse): string => {
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
        throw new Error(errorMessage);
    }

    // Find the first image part in any candidate
    for (const candidate of response.candidates ?? []) {
        const imagePart = candidate.content?.parts?.find(part => part.inlineData);
        if (imagePart?.inlineData) {
            const { mimeType, data } = imagePart.inlineData;
            return `data:${mimeType};base64,${data}`;
        }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Image generation stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`;
        throw new Error(errorMessage);
    }
    const textFeedback = response.text?.trim();
    const errorMessage = `The AI model did not return an image. ` + (textFeedback ? `The model responded with text: "${textFeedback}"` : "This can happen due to safety filters or if the request is too complex. Please try a different image.");
    throw new Error(errorMessage);
};

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
const model = 'gemini-2.5-flash-image-preview';

// --- GÜVENLİK AYARLARI ---
const safetySettings: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }, // <-- Burası çok önemli
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_UNSPECIFIED, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export const generateModelImage = async (userImage: File): Promise<string> => {
    const userImagePart = await fileToPart(userImage);
    const prompt = "You are an expert fashion photographer AI. Keep the person’s exact face, expression, and body proportions from the original image. Keep the exact same facial structure, expression, and proportions. Do not beautify, slim, or reshape any part of the face or body. Maintain the same weight and physical proportions. Only reframe the body into a standing full-length studio posture. Transform this image into a full-body, photorealistic fashion model shot suitable for a premium e-commerce website. Place the model against a clean, neutral studio backdrop (light gray, #f0f0f0) with soft, even lighting. Retain the original facial features, hairstyle, skin tone, and body shape precisely. Do not idealize or alter the figure. Adjust the posture only slightly into a natural full-body stance — relaxed, confident, and fashion-oriented. Keep all current clothing and accessories, making them appear well-lit and professional. The final image must look real, elegant, and high-quality for fashion retail use.";
const response = await ai.models.generateContent({
    model,
    contents: { parts: [userImagePart, { text: prompt }] },
    config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
});
    return handleApiResponse(response);
};


export const generateVirtualTryOnImage = async (modelImageUrl: string, garmentImage: File): Promise<string> => {
    const modelImagePart = dataUrlToPart(modelImageUrl);
    const garmentImagePart = await fileToPart(garmentImage);
    const prompt = `You are an expert virtual try-on AI. You will be given a 'model image' and a 'garment image'. Your task is to create a new photorealistic image where the person from the 'model image' is wearing the clothing from the 'garment image, maintain the person's face and Enhance the visual appeal by subtly adjusting the model’s posture, expression, and body language to convey a more confident, sensual, and fashion-forward presence — without altering the model’s identity.'.
**Input:**
- Image 1: A photo of a person (the model).
- Image 2: A photo of a garment (the product).

**TASK:**
Create a new photorealistic image where the person from Image 1 is wearing the garment from Image 2.

**Crucial Rules:**
1.  **PRESERVE THE PERSON:** The person's face, hair, skin tone, body shape, and pose from Image 1 MUST remain unchanged.
2.  **PRESERVE THE BACKGROUND:** The entire background from Image 1 MUST be preserved perfectly.
3.  **Complete Garment Replacement:** You MUST completely REMOVE and REPLACE the clothing item worn by the person in the 'model image' with the new garment. No part of the original clothing (e.g., collars, sleeves, patterns) should be visible in the final image.
4.  **REALISTIC APPLICATION:** The garment must be realistically adapted to the person's pose, with natural folds, shadows, and lighting consistent with the original scene.
5.  **OUTPUT FORMAT:** Your output MUST be ONLY the final, edited image. Do not include any text, descriptions, or explanations.`;
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [modelImagePart, garmentImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generatePoseVariation = async (tryOnImageUrl: string, poseInstruction: string): Promise<string> => {
    const tryOnImagePart = dataUrlToPart(tryOnImageUrl);
    const prompt = `You are an expert fashion photographer AI. Take this image and regenerate it from a different perspective. The person, clothing, and background style must remain identical. The new perspective should be: "${poseInstruction}". Return ONLY the final image.`;
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [tryOnImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};
//... Diğer fonksiyonlarınızın bittiği yerin altına bunu ekleyin ...

export const uploadOriginalImage = async (file: File) => {
  const formData = new FormData();
  formData.append('user_image', file); // Sunucunun beklediği anahtar 'user_image'
  try {
    const backendUrl = 'http://localhost:3001'; // Lokal Node.js sunucumuzun adresi
    
    // YOLU '/upload' OLARAK DÜZELTİYORUZ
    const response = await fetch(`${backendUrl}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sunucuya yüklenemedi. Durum: ${response.status}, Mesaj: ${errorText}`);
    }
    const result = await response.json();
    console.log('Orijinal resim yükleme sonucu:', result.message);
  } catch (error) {
    console.error('Orijinal resim yüklenirken bir hata oluştu:', error);
  }
};
export const uploadGarment = async (file: File): Promise<string> => {
  console.log('[geminiService] uploadGarment called:', file.name);

  const formData = new FormData();
  formData.append('garment_image', file);

  const response = await fetch(`http://localhost:3001/upload-garment`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kıyafet yüklenemedi. Durum: ${response.status}, Mesaj: ${errorText}`);
  }

  const result = await response.json();
  if (!result?.url) throw new Error('Sunucu URL döndürmedi.');
  return result.url;
};
export const uploadGeneratedImage = async (imageBase64: string): Promise<string> => {
  const response = await fetch('http://localhost:3001/upload-generated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData: imageBase64 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Generated image upload failed: ${text}`);
  }

  const result = await response.json();
  console.log('[uploadGeneratedImage] Uploaded URL:', result.url);
  return result.url;
};

