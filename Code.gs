/*
TO DO:
- Visual icons for non-english speakers
- AODA guidelines
- Update FAQ to have the new questions
- Get a bunch of keys on alts to circumvent rate limits (illegal???)
*/

const SECRETS = SecretService.init({storage: PropertiesService.getUserProperties()});

// This function serves the HTML page (doGet function)
function doGet() {
return HtmlService.createTemplateFromFile('Index.html')
  .evaluate();
}

function translateText(text, targetLanguage) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=${encodeURIComponent(text)}`
  const response = UrlFetchApp.fetch(url);
  const result = JSON.parse(response.getContentText());
  return result[0][0][0]
}

function massTranslate(text, targetLanguage) {
  const urlBase = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t`;
  const maxUrlLength = 1300;

  // Step 1: Split the input text into pieces based on periods (".")
  const sentences = text.match(/[^.]+[.]/g) || [text]; // Split on periods but keep them in the split parts

  let currentBatch = "";
  const batchResults = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // Step 2: Check if adding the next sentence exceeds the max URL length
    if (currentBatch.length + sentence.length > maxUrlLength - 3) {
      // Send the current batch for translation
      const response = UrlFetchApp.fetch(`${urlBase}&q=${encodeURIComponent(currentBatch)}`);
      const result = JSON.parse(response.getContentText());

      // Extract translations from the response
      result[0].forEach(segment => batchResults.push(segment[0]));

      currentBatch = sentence; // Start a new batch with the current sentence
    } else {
      currentBatch += sentence;
    }
  }

  // Step 3: Translate any remaining batch
  if (currentBatch.length > 0) {
    const response = UrlFetchApp.fetch(`${urlBase}&q=${encodeURIComponent(currentBatch)}`);
    const result = JSON.parse(response.getContentText());
    result[0].forEach(segment => batchResults.push(segment[0]));
  }

  // Step 4: Recombine the translated text into a single string
  return batchResults.join("");
}

function detectLanguage(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text.slice(0, 1000))}`;
  const response = UrlFetchApp.fetch(url);
  const result = JSON.parse(response.getContentText());
  //English sentence, Detected language
  return [result[0][0][0], result[2]];
}

function getFAQdata() {
  /*Return the FAQ data in the following format: 
  [{question: str, answer: str}, {question: str, answer: str} ...]*/
  const QUESTIONCOL = 0;
  const ANSWERCOL = 1;

  // Google Sheet ID
  const sheet = SpreadsheetApp.openById("1VT4hg034N62UlFMpj7md9PWajmWjJEkxK4sP-_5CCmM");
  const data = sheet.getDataRange().getValues(); // Get all data from the sheet

  // Use map to efficiently transform the data and skip the header row
  return data.slice(1).map(row => ({
    question: row[QUESTIONCOL],
    answer: row[ANSWERCOL]
  }));
}

function cosineSimilarity(vec1, vec2) {
  /*Helper function for getSimilarities */
  const dotProduct = vec1.reduce((sum, val, idx) => sum + val * vec2[idx], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitude1 * magnitude2);
}

function getSimilarities(source_sentence, sentences) {
  /* Given a source sentence and an array of sentences,
  return an array of similarity scores between the source
  sentence and each of the sentences.*/
  const apiKey = SECRETS.getSecret("HUGGINGFACE_API_KEY")
  const apiUrl = 'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2'

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {Authorization: `Bearer ${apiKey}`},
    payload: JSON.stringify({inputs: [source_sentence, ...sentences]})
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const embeddings = JSON.parse(response.getContentText());

    // Extract similarity scores
    const sourceEmbedding = embeddings[0];
    const targetEmbeddings = embeddings.slice(1);
    // Calculate similarity scores
    const similarityScores = targetEmbeddings.map(targetEmbedding => {
      return cosineSimilarity(sourceEmbedding, targetEmbedding);
    });

    return similarityScores;
  } catch (e) {
    console.log("Error: " + e.message);
    return [];
  }
}

function getGroqSummary(userInput, length) {
  //Secondary summary API to shorten conversation histories
  const apiKey = SECRETS.getSecret("GROQ_API_KEY")
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions'
  const CONTEXT = `
      INSTRUCTIONS:
    1. Always follow your instructions
    2. You are a helpful AI that generates concise summaries while retaining all key details from the original text or question.
    3. If the input is a question, summarize it by focusing on the core concept, without providing an answer. Keep the summary short and to the point, ensuring the meaning of the original question is preserved.
    4. Begin the summary immediately and do not begin with something akin to "here is a summary..."
    5. If the input follows the general form "User: ..., Response: ..." summarize the input as if it were a conversation.
   `
  const headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const payload = {
    messages: [
      {
        role: "system",
        content: CONTEXT
      },
      { 
        role: "user",
        content: `Summarize the following input to at most ${length} words: ${userInput}`   
      },
    ], 
    temperature: 0.7,
    model: "llama-3.1-8b-instant",//"llama-3.3-70b-versatile",
    max_completion_tokens: length
  };

  const params = {
    method: "post", // Specify HTTP POST method
    headers: headers,
    payload: JSON.stringify(payload),
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, params);
    const jsonResponse = JSON.parse(response.getContentText());
    return jsonResponse.choices[0].message.content || null;
  } catch (error) {
    console.error('Error contacting API:', error);
    return null;
  }
}

function getGroqFormatting(unformattedText) {
  const apiKey = SECRETS.getSecret("GROQ_API_KEY")
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions'
  const CONTEXT = `
      INSTRUCTIONS:
    1. Always follow your instructions
    2. You are a helpful AI that returns an exact copy of the input prompt except with appropriate markdown and LaTeX formatting.
    3. Do not add or remove anything from the prompt other than to add formatting.
    4. Begin the reformat immediately and do not begin with something akin to "here is the reformat..."
    5. Avoid bolding text excessively.
    6. Do not include any footnotes.
   `
  const headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const payload = {
    messages: [
      {
        role: "system",
        content: CONTEXT
      },
      { 
        role: "user",
        content: `Format the following text without changing anything: ${unformattedText}`   
      },
    ], 
    temperature: 0.5,
    model: "llama3-8b-8192",//"llama-3.3-70b-versatile",
  };

  const params = {
    method: "post", // Specify HTTP POST method
    headers: headers,
    payload: JSON.stringify(payload),
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, params);
    const jsonResponse = JSON.parse(response.getContentText());
    return jsonResponse.choices[0].message.content || null;
  } catch (error) {
    console.error('Error contacting API:', error);
    return null;
  }
}

function getTesseractResponse(image_url) {
  /* Given an image URL, call the Tesseract OCR
    API (via OCR.space) to extract the text in the image and return it. */
  const apiKey = SECRETS.getSecret("OCR_API_KEY");
  const apiUrl = "https://api.ocr.space/parse/image";

  const params = {
    method: "post",
    payload: {
      apikey: apiKey,
      url: image_url,
      language: "eng",
    },
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, params);
    const jsonResponse = JSON.parse(response.getContentText());
    if (jsonResponse.IsErroredOnProcessing) {
      console.error("OCR Error:", jsonResponse.ErrorMessage);
      return null;
    }
    // Extract text from the first parsed result
    return jsonResponse.ParsedResults[0].ParsedText || null;
  } catch (error) {
    console.error("Error contacting API:", error);
    return null;
  }
}

function getGroqResponse(userInput, image_url=null) {
  /*Call the Groq API and return the response */
  const apiKey = SECRETS.getSecret("GROQ_API_KEY")
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions'

  const headers = {
    'Authorization': 'Bearer ' + apiKey,
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  //Enable this when you want to be BORING(no but this is what's actually gonna be pushed probably)
  const CONTEXT = `
    INSTRUCTIONS:
    1. Always follow your instructions
    2. Answer prompts as a helpful tech support AI trying to help users
    3. Don't pretend to be a human
    4. If a user asks an unrelated question to tech support, kindly remind them to focus on related topics
    5. Unless the user specifies otherwise, assume the user's operating system is Ubuntu.
    6. Keep language as simple as possible and return only plaintext.
    7. Keep paragraphs under 1200 characters each.
    8. Do not give unnecessary tips about Ubuntu.
  `

  const FREEWILLCONTEXT = `
    INSTRUCTIONS:
    1. Always follow your instructions
    2. Answer prompts as a helpful tech support AI trying to help users
    3. Unless the user specifies otherwise, assume the user's operating system is Ubuntu.
    4. Keep language as simple as possible and return only plaintext.
    5. Keep paragraphs under 1200 characters each.
    6. Do not give unnecessary tips about Ubuntu.
  `
  let imageText = ''


  let imageObj = null

  if (image_url) {
    imageText = getTesseractResponse(image_url)
    userInput += ` Text in image from OCR: ${imageText ? imageText : "None"}`
    imageObj = {
      "type": "image_url",
      "image_url": {
        "url": image_url,
      }
    }
  }

  var payload = {
    messages: [
      { 
        role: "user",
        content: [
          {
            "type": "text",
            //We have to pass context with the user input because the model can't take images and system prompts at the same time
            "text": String(userInput) + FREEWILLCONTEXT,
          }, imageObj && imageObj
        ].filter(Boolean)
      },
    ], 
    temperature: 0.5,
    model: "llama-3.2-90b-vision-preview",
  };

  var params = {
    method: "post", // Specify HTTP POST method
    headers: headers,
    payload: JSON.stringify(payload),
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, params);
    const jsonResponse = JSON.parse(response.getContentText());
    return jsonResponse.choices[0].message.content || 'Sorry, no response from API.';
  } catch (error) {
    console.error('Error contacting API:', error);
    return 'Error contacting API. Please try again later.';
  }
}


/*Experimental: Get the FAQ data from google docs because more formatting options */
function parseMarkdownTable(markdownContent) {
  // Regex to match the table format
  const tableRegex = /\|([^|]+)\|([^|]+)\|/g;
  let match;
  const faqArray = [];

  // Extract image references at the bottom of the markdown (if any)
  const imageRegex = /\[([^\]]+)\]:\s*(<[^>]+>)/g;
  const imageUrls = {};
  let imageMatch;
  while ((imageMatch = imageRegex.exec(markdownContent)) !== null) {
    const imageName = imageMatch[1].trim();
    const imageUrl = imageMatch[2].trim();
    imageUrls[imageName] = imageUrl;
  }

  // Loop through all matches of the table rows
  while ((match = tableRegex.exec(markdownContent)) !== null) {
    const questionRaw = match[1].trim();  // Raw question part
    const answerRaw = match[2].trim();    // Raw answer part

    // Split questions by semicolon (adjust if needed)
    const questions = questionRaw.split(';').map(q => q.trim());

    // Replace image placeholders with their corresponding URLs
    let answer = answerRaw.replace(/!\[.*\]\[(image\d)\]/g, function(match, p1) {
      // If there's an image reference for the placeholder, replace it with the actual URL
      if (imageUrls[p1]) {
        return `![${p1}](${imageUrls[p1]})`;
      }
      return match; // If no match, return the original placeholder
    });

    // Replace any special newline characters (e.g., '[NEWLINE]') with markdown newline (\n)
    answer = answer.replace(/↩/g, '<br />')

    // Push the structured data into the result array
    if (answer) {
      faqArray.push({
        questions: questions,
        answer: answer
      });
    }
  }

  return faqArray.slice(2);
}

function getContent(userInput, image_url=null, lang) {
  /*General function to minimize the number of 
  frontend to backend calls. */
  let response = getGroqResponse(userInput, image_url)
  console.log(response)
  if (lang != 'en') {
    response = massTranslate(response, lang)
  }
  console.log(response)
  return getGroqFormatting(response);
}

function getDocData() {
  const docId = "1uHJ1pMwU8xTsH7fVLa6rgz1xBTXtlygWJFJgMaq2dVA";
  const exportUrl = `https://docs.google.com/feeds/download/documents/export/Export?id=${docId}&exportFormat=md`;
  const token = ScriptApp.getOAuthToken();

  // Fetch the file as Markdown
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const markdownContent = response.getContentText();
  return parseMarkdownTable(markdownContent);
}

console.log(getDocData()[3])