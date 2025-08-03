document.addEventListener("DOMContentLoaded", () => {
    // --- DOM Element Selectors ---
    const recordButton = document.getElementById("recordButton");
    const statusText = document.getElementById("recordingStatus");
    const polishedNote = document.getElementById("polishedNote");
    const rawTranscription = document.getElementById("rawTranscription");
    const newButton = document.getElementById("newButton");
    const themeToggleButton = document.getElementById("themeToggleButton");
    const polishButton = document.getElementById("polishButton");
    const sendSlackButton = document.getElementById("sendSlackButton");
    const sendEmailButton = document.getElementById("sendEmailButton");
    const uploadButton = document.getElementById("uploadButton");
    const audioUploadInput = document.getElementById("audioUpload");
  
    // --- Integration Modal Elements ---
    const integrationModal = document.getElementById("integrationModal");
    const openIntegrationSettings = document.getElementById("openIntegrationSettings");
    const closeButton = document.querySelector(".close-button");
    const integrationForm = document.getElementById("integrationForm");
  
    // --- Transcription Engine Controls ---
    const engineLocalRadio = document.getElementById("engineLocal");
    const engineOpenAIRadio = document.getElementById("engineOpenAI");
    const engineDeepgramRadio = document.getElementById("engineDeepgram");
    const localModelOptions = document.getElementById("localModelOptions");
    const transcriptionApiKeyField = document.getElementById("transcriptionApiKeyField");
    const transcriptionApiKeyInput = document.getElementById("transcriptionApiKey");
  
    // --- Polishing Controls ---
    const polishProvider = document.getElementById("polishProvider");
    const polishApiKeyContainer = document.getElementById("polishApiKeyContainer");
    const polishApiKeyInput = document.getElementById("polishApiKey");
  
    // --- Tab Controls ---
    const tabButtons = document.querySelectorAll(".tab-button");
    const noteContents = document.querySelectorAll(".note-content");
  
    // --- State Variables ---
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let integrationConfigs = {}; // Stores integration settings for the session
  
    // --- API for local development ---
    const API_BASE_URL = "http://localhost:8000";
  
    // --- Core Logic Functions ---
      async function toggleRecording() {
      if (isRecording) {
        mediaRecorder.stop();
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          isRecording = true;
          recordButton.classList.add("recording");
          recordButton.innerHTML = '<i class="fas fa-stop"></i>';
          statusText.textContent = "Recording...";
          
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
          mediaRecorder.onstop = () => {
            isRecording = false;
            recordButton.classList.remove("recording");
            recordButton.innerHTML = '<i class="fas fa-microphone"></i>';
            statusText.textContent = "Processing...";
            stream.getTracks().forEach(track => track.stop());
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            handleTranscription(audioBlob);
          };
          mediaRecorder.start();
        } catch (error) {
          console.error("Error accessing microphone:", error);
          statusText.textContent = "Error accessing microphone.";
        }
      }
    }
  
    async function handleTranscription(audioBlob, fileName = "recording.wav") {
      if (!audioBlob || audioBlob.size === 0) {
        statusText.textContent = "No audio to transcribe.";
        return;
      }
      
      statusText.textContent = "Sending for transcription...";
      const formData = new FormData();
      formData.append("file", audioBlob, fileName);
      const engineSource = document.querySelector('input[name="engineSource"]:checked').value;
      formData.append("source", engineSource);
  
      if (engineSource === "local") {
        formData.append("model_size", document.getElementById("modelSize").value);
      } else if (engineSource === "openai" || engineSource === "deepgram") {
        const apiKey = transcriptionApiKeyInput.value;
        if (!apiKey) {
          alert(`Please enter your ${engineSource.charAt(0).toUpperCase() + engineSource.slice(1)} API key.`);
          statusText.textContent = "Ready to record";
          return;
        }
        formData.append("api_key", apiKey);
      }
      
      try {
        const response = await fetch(`${API_BASE_URL}/transcribe`, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const data = await response.json();
        rawTranscription.textContent = data.transcription || '';
        polishedNote.innerHTML = '';
        disableIntegrationButtons();
        statusText.textContent = "Transcription complete. You can now polish the text.";
        switchTab('rawTranscription');
      } catch (error) {
        console.error("Transcription error:", error);
        statusText.textContent = "Transcription error.";
        alert("An error occurred while contacting the transcription server.");
      }
    }
    
    async function handlePolishRequest() {
      const rawText = rawTranscription.textContent.trim();
      const provider = polishProvider.value;
      const apiKey = polishApiKeyInput.value;
  
      if (!rawText) { 
        alert('There is no text to polish.'); 
        return; 
      }
      if (!apiKey) { 
        alert('Please enter the API key for the selected provider.'); 
        return; 
      }
  
      statusText.textContent = `Polishing with ${provider}...`;
      disableIntegrationButtons();
      
      try {
        const payload = {
          raw_text: rawText,
          provider,
          api_key: apiKey,
          company_context: document.getElementById('companyContext').value,
          project_context: document.getElementById('projectContext').value,
        };
        
        const response = await fetch(`${API_BASE_URL}/polish`, {
          method: "POST",
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const data = await response.json();
        polishedNote.innerHTML = data.polished_text_html || 'An error occurred while polishing.';
        statusText.textContent = "Text polished successfully!";
        enableIntegrationButtons();
        switchTab('polishedNote');
      } catch (error) {
        console.error("Error polishing:", error);
        statusText.textContent = "Error polishing text.";
        alert("An error occurred while contacting the polishing server.");
      }
    }
  
    async function sendToSlack() {
      const content = polishedNote.innerText;
      if (!content) { 
        alert("No polished text to send."); 
        return; 
      }
      if (!integrationConfigs.slackWebhook) { 
        alert("Slack Webhook URL not configured."); 
        return; 
      }
      
      statusText.textContent = "Sending to Slack...";
      try {
        const response = await fetch(`${API_BASE_URL}/integrations/slack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_url: integrationConfigs.slackWebhook,
            text: content
          })
        });
        if (!response.ok) throw new Error('Failed to send to Slack');
        alert("Sent to Slack successfully!");
        statusText.textContent = "Sent to Slack!";
      } catch (error) {
        console.error("Slack Error:", error);
        alert("Error sending to Slack.");
        statusText.textContent = "Failed to send to Slack.";
      }
    }
  
    async function sendByEmail() {
      const content = polishedNote.innerHTML; // Send as HTML
      if (!content) { 
        alert("No polished text to send."); 
        return; 
      }
      if (!integrationConfigs.smtpEmail || !integrationConfigs.recipientEmail) {
        alert("Email settings are incomplete.");
        return;
      }
  
      statusText.textContent = "Sending email...";
      try {
        const payload = { ...integrationConfigs, html_content: content, subject: document.querySelector('.editor-title').textContent };
        const response = await fetch(`${API_BASE_URL}/integrations/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to send email');
        }
        alert("Email sent successfully!");
        statusText.textContent = "Email sent!";
      } catch (error) {
        console.error("Email Error:", error);
        alert(`Error sending email: ${error.message}`);
        statusText.textContent = "Failed to send email.";
      }
    }
  
    // --- UI and Initialization Functions ---
  
    function updateEngineUI() {
      const useAPI = engineOpenAIRadio.checked || engineDeepgramRadio.checked;
      const useLocal = engineLocalRadio.checked;
  
      localModelOptions.style.display = useLocal ? "block" : "none";
      transcriptionApiKeyField.style.display = useAPI ? "block" : "none";
    }
  
    function createNewNote() {
      rawTranscription.textContent = '';
      polishedNote.innerHTML = '';
      document.querySelector('.editor-title').textContent = 'Untitled Note';
      statusText.textContent = 'Ready to record';
      disableIntegrationButtons();
      switchTab('polishedNote');
    }
  
    function toggleTheme() {
      const isLight = document.body.classList.toggle("light-mode");
      localStorage.setItem("theme", isLight ? "light" : "dark");
      themeToggleButton.querySelector("i").className = isLight ? 'fas fa-moon' : 'fas fa-sun';
    }
  
    function initTheme() {
      if (localStorage.getItem("theme") === "light") {
        document.body.classList.add("light-mode");
        themeToggleButton.querySelector("i").className = 'fas fa-moon';
      }
    }
  
    function enableIntegrationButtons() {
      sendSlackButton.disabled = false;
      sendEmailButton.disabled = false;
    }
  
    function disableIntegrationButtons() {
      sendSlackButton.disabled = true;
      sendEmailButton.disabled = true;
    }
    
    function switchTab(tabId) {
      noteContents.forEach(content => content.classList.remove('active'));
      tabButtons.forEach(button => button.classList.remove('active'));
  
      document.getElementById(tabId).classList.add('active');
      document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
    }
  
    // --- Modal Logic ---
    openIntegrationSettings.onclick = () => { integrationModal.style.display = "flex"; };
    closeButton.onclick = () => { integrationModal.style.display = "none"; };
    window.onclick = (event) => {
      if (event.target == integrationModal) {
        integrationModal.style.display = "none";
      }
    };
    integrationForm.onsubmit = (e) => {
      e.preventDefault();
      integrationConfigs = {
        slackWebhook: document.getElementById('slackWebhook').value,
        smtpEmail: document.getElementById('smtpEmail').value,
        recipientEmail: document.getElementById('recipientEmail').value,
        smtpServer: document.getElementById('smtpServer').value,
        smtpPassword: document.getElementById('smtpPassword').value,
      };
      alert('Settings saved for this session.');
      integrationModal.style.display = 'none';
    };
    
    // --- Attach Event Listeners ---
    recordButton.addEventListener("click", toggleRecording);
    newButton.addEventListener("click", createNewNote);
    themeToggleButton.addEventListener("click", toggleTheme);
    polishButton.addEventListener("click", handlePolishRequest);
    sendSlackButton.addEventListener("click", sendToSlack);
    sendEmailButton.addEventListener("click", sendByEmail);
    engineLocalRadio.addEventListener("change", updateEngineUI);
    engineOpenAIRadio.addEventListener("change", updateEngineUI);
    engineDeepgramRadio.addEventListener("change", updateEngineUI);
  
    uploadButton.addEventListener("click", () => audioUploadInput.click());
    audioUploadInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) {
        handleTranscription(file, file.name);
      }
    });
  
    tabButtons.forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
  
    // --- Initial Execution ---
    updateEngineUI();
    initTheme();
    switchTab('polishedNote');
  });