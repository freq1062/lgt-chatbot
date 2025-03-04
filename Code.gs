/*To do:
- Vector database instead of huggingface? Get rid of that "api starting up" error 
- Be able to see previous questions and answers by pressing left and right arrows to navigate
- Scavenger hunt event activities
 */
const SECRETS = SecretService.init({storage: PropertiesService.getUserProperties()});

// This function serves the HTML page (doGet function)
function doGet() {
return HtmlService.createTemplateFromFile('Index.html')
  .evaluate();
}

function getToken(serv) {
  /*Given a service, returns the appropriate API key 
  to avoid rate limit. Services are GROQ, HF, OCR */
  const scriptProperties = PropertiesService.getScriptProperties();
  const usages = JSON.parse(scriptProperties.getProperty("USAGE"))[serv]
  switch(serv) {
    case "GROQ":
      minCounts = [Infinity, Infinity]
      for (const key in usages) {
        /*Rate limit: 3500 requests per day, 250,000 tokens per day 
        I doubt we'll hit the 15 per minute or 7000 tokens per minute*/
        const { completion_tokens, count } = usages[key];
        if (completion_tokens < minCounts[0] || count < minCounts[1]) {
          minCounts = [completion_tokens, count]
          selectedKey = key;
        }
      }
      return selectedKey;
    case "OCR":
    case "HF":
      minCount = Infinity
      for (const key in usages) {
        const value = usages[key];
        if (value < minCount) {
          minCount = value;
          selectedKey = key;
        }
      }
      return selectedKey;
    default: throw new Error("Unknown service: " + serv);
  }
}

function addTokens(ocr, hf, groq) {
  /*After adding the tokens to SecretService,
  update script properties - helper function*/
  const scriptProperties = PropertiesService.getScriptProperties();
  const usages = JSON.parse(scriptProperties.getProperty("USAGE"))
  usages["OCR"][ocr] = 0
  usages["HF"][hf] = 0
  usages["GROQ"][groq] = {"count": 0, "completion_tokens": 0}
}

function updateToken(serv, key, completion_tokens=null) {
  /*Given a service and the key that was called, update
  the script properties to keep track of used calls */
  const scriptProperties = PropertiesService.getScriptProperties();
  const lastUpdateStr = scriptProperties.getProperty("LAST_UPDATE");
  //Initialize lastUpdate if its not already there
  const lastUpdate = lastUpdateStr ? JSON.parse(lastUpdateStr) : { timestamp: new Date().getTime() };
  const usages = JSON.parse(scriptProperties.getProperty("USAGE"));

  //Reset all the tokens every 24 hours
  const currentTime = new Date().getTime();
  const oneDayInMillis = 24 * 60 * 60 * 1000;
  if (currentTime - lastUpdate.timestamp > oneDayInMillis) {
    for (let service in usages) {
      for (let key in usages[service]) {
        if (service === "GROQ") {
          usages[service][key].completion_tokens = 0;
          usages[service][key].count = 0;
        } else {
          usages[service][key] = 0;
        }
      }
    }
  }
  lastUpdate.timestamp = currentTime;
  
  //Actually update the tokens
  switch(serv) {
    case "GROQ":
      /*We only keep track of 90b-vision because summary, formatting
      output similar tokens and those have much higher rate limits */
      usages[serv][key].completion_tokens += completion_tokens;
      usages[serv][key].count += 1;
      break;
    case "OCR":
      usages[serv][key] += 1
      break;
    case "HF":
      usages[serv][key] += 1
      break;
    default: throw new Error("Unknown service: " + serv);
  }
  scriptProperties.setProperty("USAGE", JSON.stringify(usages))
  scriptProperties.setProperty("LAST_UPDATE", JSON.stringify(lastUpdate))
}

function translateText(text, targetLanguage) {
  /*Given a short length of text, return
  the translated text in targetLanguage.*/
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage)}&dt=t&q=${encodeURIComponent(text)}`
  try {
    const response = UrlFetchApp.fetch(url);
    const result = JSON.parse(response.getContentText());
    return result[0][0][0]
  } catch(e) {
    throw new Error("Unable to translate text: \n" + e)
  }
}

function massTranslate(text, targetLanguage) {
  /* Given a long string of text, batch translations
  by sentences to minimize API calls.*/
  try {
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
  } catch(e) {
    throw new Error("Unable to mass translate: \n" + e.message)
  }
}

function massArrTranslate(textArr, targetLanguage) {
  /* Given an array of text representing text elements,
  return an array of the same length with each element translated.*/
  try{
    let text = textArr.join("|||")
    const translatedText = massTranslate(text, targetLanguage)
    return translatedText.split("|||")    
  } catch(e) {
    throw new Error("Unable to translate elements: \n" + e.message)
  }
}

function detectLanguage(text) {
  /*Given a string of text, return the language as a Google Translate string*/
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text.slice(0, 1000))}`;
    const response = UrlFetchApp.fetch(url);
    const result = JSON.parse(response.getContentText());
    //English sentence, Detected language
    return [result[0][0][0], result[2]];
  } catch(e) {
    throw new Error("Unable to detect language: \n" + e.message)
  }
}

function getFAQdata() {
  /*Return the FAQ data in the following format: 
  [{questions: [str, str], answer: str}, ...]\
  If the answer is a pdf, return the embeddable pdf link
  If the answer is markdown, return the raw text
  If the answer is plaintext, return the plaintext
  */
  const QUESTIONCOL = 0;
  const ANSWERCOL = 1;

  try {
    // Google Sheet ID
    const sheet = SpreadsheetApp.openById("1VT4hg034N62UlFMpj7md9PWajmWjJEkxK4sP-_5CCmM");
    const data = sheet.getDataRange().getValues(); // Get all data from the sheet
    let result = [];

    for (var i = 1; i < data.length; i++) {
      const questions = String(data[i][QUESTIONCOL]).split(";").map(q => q.trim());
      var answer = String(data[i][ANSWERCOL])
      //Ignore merged headers and empty answers
      if (answer){
        //Plaintext is also rendered as markdown, however doesn't have newline
        var type = "markdown"

        //Check if answer is a link to a google drive file
        if (answer.startsWith("https://drive.google.com/file/d/")) {
          const match = answer.match(/\/d\/(.+)\//)
          if (match) {
            var id = match[1]
            try {
              var file = DriveApp.getFileById(id);
              var mimeType = file.getMimeType();
              //Check between markdown and pdf
              if (mimeType == 'text/markdown') {
                answer = file.getBlob().getDataAsString()
              } else if (mimeType == 'application/pdf') {
                answer = `https://drive.google.com/file/d/${id}/preview`
                type = "pdf"
              }
            } catch(e) {
              answer = "Invalid file ID:", answer
            }
          } else {
            answer = `Invalid file: ${answer}`
          }
        }
        result.push({ questions: questions, answer: answer, type: type });
      }
    }
    return result
  } catch(e) {
    throw new Error("Unable to pull FAQ data: \n" + e.message)
  }
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
  const apiKey = getToken("HF")
  const apiUrl = 'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2'

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {Authorization: `Bearer ${SECRETS.getSecret(apiKey)}`},
    payload: JSON.stringify({inputs: [source_sentence, ...sentences]})
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const embeddings = JSON.parse(response.getContentText());
    updateToken("HF", apiKey)

    // Extract similarity scores
    const sourceEmbedding = embeddings[0];
    const targetEmbeddings = embeddings.slice(1);
    // Calculate similarity scores
    const similarityScores = targetEmbeddings.map(targetEmbedding => {
      return cosineSimilarity(sourceEmbedding, targetEmbedding);
    });

    return similarityScores;
  } catch (e) {
    throw new Error("Error calculating similarities: \n" + e.message)
  }
}

function getGroqSummary(userInput, length) {
  //Secondary summary API to shorten conversation histories
  const apiKey = getToken("GROQ")
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions'
  const CONTEXT = `
  You are a helpful AI that generates concise summaries while retaining all key details from the original text or question. Begin the summary immediately and do not begin with something akin to "here is a summary...". If the input is a question, summarize it by focusing on the core concept, ensuring the meaning of the original question is preserved. Do not provide an answer. If the input follows the general form "User: ..., Response: ..." summarize the input as if it were a conversation. Above all, keep the summary short and to the point without including stop words, filler words or jargon.`
  const headers = {
    'Authorization': 'Bearer ' + SECRETS.getSecret(apiKey),
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
    model: "llama-3.1-8b-instant",
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
  } catch (e) {
    throw new Error("Unable to generate summary: \n" + e,message)
  }
}

function getGroqFormatting(unformattedText) {
  const apiKey = getToken("GROQ")
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions'
  const CONTEXT = `
  You are a helpful AI that returns an exact copy of the input prompt except with appropriate markdown and LaTeX formatting. Do not add or remove anything from the prompt other than to add necessary formatting and if there is already existing formatting, do not alter it unless the syntax is incorrect. Begin the reformat immediately and do not begin with something akin to "here is the reformat..." and do not include any footnotes, excessive bold text, or any redundant or over the top formatting.`
  const headers = {
    'Authorization': 'Bearer ' + SECRETS.getSecret(apiKey),
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
        content: `Please format the following text: ${unformattedText}`   
      },
    ], 
    temperature: 0.5,
    model: "llama-3.3-70b-versatile",
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
  } catch (e) {
    throw new Error("Unable to format response: \n" + e.message)
  }
}

function getTesseractResponse(base64_image) {
  /* Given an image URL in base 64 format, call the Tesseract OCR
    API (via OCR.space) to extract the text in the image and return it. */
  const apiKey = getToken("OCR")
  const apiUrl = "https://api.ocr.space/parse/image";

  const params = {
    method: "post",
    payload: {
      apikey: SECRETS.getSecret(apiKey),
      base64Image: base64_image,
      language: "eng",
    },
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, params);
    const jsonResponse = JSON.parse(response.getContentText());
    updateToken("OCR", apiKey)
    if (jsonResponse.IsErroredOnProcessing) {
      throw new Error(`Error processing iamge: ${jsonResponse.ErrorMessage}`)
    }
    // Extract text from the first parsed result
    return jsonResponse.ParsedResults[0].ParsedText || null;
  } catch (e) {
    // OCR is optional anyway so just continue if it doesn't work
    throw new Error("Could not read text from image: \n" + e.message)
  }
}

function getGroqResponse(userInput, image_url=null) {
  /*Call the Groq API and return the response */
  const apiKey = getToken("GROQ")
  const apiUrl = 'https://api.groq.com/openai/v1/chat/completions'
  const headers = {
    'Authorization': 'Bearer ' + SECRETS.getSecret(apiKey),
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  const CONTEXT = `
    You are a helpful tech support AI trying to help users. Unless the user specifies otherwise, assume the user's operating system is Ubuntu. Keep language as simple as possible and return only plaintext. Do not give unnecessary tips about Ubuntu and keep paragraphs under 1200 characters each. Assuming this role, answer the following question: `
  let imageText = ''


  let imageObj = null

  if (image_url) {
    try {
      imageText = getTesseractResponse(image_url)
      userInput += ` Text in image from OCR: ${imageText ? imageText : "None"}`
      imageObj = {
        "type": "image_url",
        "image_url": {
          "url": image_url,
        }
      }      
    } catch(e) {
      throw new Error("Unable to read from image: \n" + e.message)
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
            "text": CONTEXT + String(userInput)
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
    updateToken("GROQ", apiKey, jsonResponse.usage.completion_tokens)
    return jsonResponse.choices[0].message.content || 'Sorry, no response from API.';
  } catch (e) {
    throw new Error("Unable to get response from AI: \n" + e.message)
  }
}

function getContent(userInput, base64_image=null, lang) {
  /*General function to minimize the number of 
  frontend to backend calls. */
  try {
    let response = getGroqResponse(userInput, base64_image)
    if (lang != 'en') {
      response = massTranslate(response, lang)
    }
    return getGroqFormatting(response);
  } catch(e) {
    throw new Error("Unable to generate response: \n" + e.message)
  }
}