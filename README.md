# lgt-chatbot

**A tech support AI chatbot written using Google Apps Script.** Written for the [Let's Get Together](https://www.letsgettogether.ca/) nonprofit as a part of the 2024 [Social Innovation Project](https://www.utm.utoronto.ca/utm-engage/volunteering/social-innovation-project) volunteer organization.
See the chatbot in action [here](https://sites.google.com/view/lgt-help/home)

[Direct Google Macro Link](https://script.google.com/macros/s/AKfycbyT4pZE8nHDmnZ6YET55d5dGkN37KD-lhQcQfBIwaJtby-5cpr6eomRamjsgeyTuB2h/exec)
<img width="1568" height="556" alt="image" src="https://github.com/user-attachments/assets/ce6d1690-7e55-41d3-a5e9-8c2ce24ce3d9" />

## Features
1. Chat memory: Whenever an input is received, the backend stores a summary of the overall conversation to allow the user to refer to things that have been brought up since starting the conversation.
2. Retrieval Augmented Generation (RAG): Whenever the user asks a question that matches with a list of questions and answers in a separate Google Sheet, the matching answer is returned instead of the normal LLM response to allow for more targeted and relevant responses.
<img width="374" height="114" alt="image" src="https://github.com/user-attachments/assets/9909a93a-767c-45de-ac0b-e4d5df08db15" />
3. Image recognition: The user can upload an image, and an OCR model will read the text from the image as well as give a high level overview of what the image contains. This allows the user to simply take a screenshot of any error messages they might have.
4. Automatic translation: If the user asks a question in a language other than English, all responses and aspects of the chatbot box are translated to their respective language through the Google Translate API.

## Limitations

Because all the API calls are off of free credits, there is a limit to how many questions can be asked per day. This has been partially mitigated internally by keeping 5 free API keys that are rotated. Also, the delay for a response can sometimes be long, especially for images. 

Reloading the page resets all memory that the conversation had. This is unfortunately not fixable because the chatbot is an embed to a Google Apps Script, which doesn't allow for caching.

## What I learned

I learned how to implement a simple RAG system, how to connect various APIs to make a robust system, how to coordinate with a team and get feedback from non-technical supervisors, how to lead a test event and explain technical details to students, and how to deploy something from Google Apps Script to real users.

# How to Contribute to GitHub
1. Create a fork of this project to work on in your own GitHub account.

2. Install the following [Chrome extension](https://chromewebstore.google.com/detail/google-apps-script-github/lfjcgcmkmjjlieihflfhjopckgpelofo?hl=en).

3. Go to [GitHub's Personal Access Token Settings](https://github.com/settings/tokens) and generate a new token with **"repo"** and **"gist"** scopes.

4. Open the [Google Apps Script Editor](https://script.google.com/home) and create a new project to pull this repo into.

5. When prompted, fill in your username and access token in the popup from the Chrome extension.

6. There should be a **"Repository"** option in the editor. Select the fork you made of this repo and press the downward-facing arrow to pull the code into the editor.

7. Make your changes, test the deployment with the "test deployment" option in Google Apps Script and press the upward-facing arrow to push those changes. Then make a pull request to merge your fork with the main branch (which is actually being shown on the website).
