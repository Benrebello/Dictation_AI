import os
import shutil
import requests
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Dict
import asyncio
import uuid
import json

from fastapi import FastAPI, UploadFile, File, Form, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, HttpUrl

try:
    import whisper
    import google.generativeai as genai
    import anthropic
    from markdown_it import MarkdownIt
    from deepgram import DeepgramClient, PrerecordedOptions, FileSource
    from groq import Groq
    from openai import OpenAI
except ImportError:
    print("WARNING: One or more AI libraries are not installed.")
    print("Install them with all dependencies from requirements.txt")

# --- 1. Start the application ---
app = FastAPI(
    title="Dictation AI Backend",
    description="Transcription, polishing, and integration services for Dictation AI.",
    version="1.0.0"
)

# --- CORS Middleware Configuration ---
origins = [
    "https://dictation.yourdomain.com", # production domain
    "http://localhost",                 # testing on localhost
    "http://127.0.0.1",               # testing on localhost
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. Pydantic models for validation ---
class PolishRequest(BaseModel):
    provider: str 
    raw_text: str
    api_key: str
    company_context: Optional[str] = ""
    project_context: Optional[str] = ""

class SlackRequest(BaseModel):
    webhook_url: HttpUrl
    text: str

class EmailRequest(BaseModel):
    smtpEmail: EmailStr
    recipientEmail: EmailStr
    smtpServer: str
    smtpPassword: str
    html_content: str
    subject: str

# --- 3. API ENDPOINTS ---

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    source: str = Form(...),
    api_key: Optional[str] = Form(None),
    model_size: str = Form("small")
):
    unique_id = uuid.uuid4()
    file_extension = os.path.splitext(file.filename)[1]
    temp_path = f"temp_{unique_id}{file_extension}"
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        transcription = ""
        if source == "local":
            print(f"Transcribing locally with model: {model_size}")
            model = whisper.load_model(model_size)
            result = model.transcribe(temp_path, language="en")
            transcription = result["text"]
        
        elif source == "openai":
            if not api_key:
                raise HTTPException(status_code=400, detail="API key is required for OpenAI transcription.")
            print("Transcribing via OpenAI API...")
            try:
                client = OpenAI(api_key=api_key)
                with open(temp_path, "rb") as audio_file:
                    result = client.audio.transcriptions.create(
                        model="whisper-1",
                        file=audio_file
                    )
                    transcription = result.text
            except Exception as e:
                print(f"OpenAI Transcription Error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"OpenAI API Error: {str(e)}")
        
        elif source == "deepgram":
            if not api_key:
                raise HTTPException(status_code=400, detail="API key is required for Deepgram transcription.")
            print("Transcribing via Deepgram API...")
            try:
                deepgram = DeepgramClient(api_key)
                with open(temp_path, "rb") as audio_file:
                    buffer_data = audio_file.read()
                
                payload: FileSource = {"buffer": buffer_data}
                options = PrerecordedOptions(model="nova-2", smart_format=True)
                response = await deepgram.listen.prerecorded.v("1").transcribe_file(payload, options)
                transcription = response.results.channels[0].alternatives[0].transcript
            except Exception as e:
                print(f"Deepgram Error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Deepgram error: {str(e)}")
        
        else:
            raise HTTPException(status_code=400, detail="Invalid transcription source.")
        
        return {"transcription": transcription}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Generic Transcription Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"An error occurred: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/polish")
async def polish(request: PolishRequest):
    """Refines raw text using an LLM and returns the result as HTML."""
    
    base_prompt = f"""Act as an expert in transceiving audio and correcting grammar. Create a polished text with a basic summary of the topics covered to send to the company's internal communication channels. Your base text is "{request.raw_text}".
    """

    context_details = ""
    if request.company_context:
        context_details += f"\nCompany Jargon: {request.company_context}"
    if request.project_context:
        context_details += f"\nProject Details: {request.project_context}"
    
    if context_details:
        prompt = f"{base_prompt}\nDetails to consider for response:\n{context_details}"
    else:
        prompt = base_prompt
    
    polished_markdown = ""
    try:
        model_id = request.provider 
        
        openai_models = ["gpt-4o-2024-05-13", "o4-mini-2025-04-16", "gpt-4.1-2025-04-14", "o3-2025-04-16"]
        groq_models = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "meta-llama/llama-4-maverick-17b-128e-instruc", "meta-llama/llama-4-scout-17b-16e-instruct"]
        google_models = ["gemini-2.5-pro", "gemini-2.5-flash"]
        anthropic_models = ["claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022"]

        if model_id in groq_models:
            client = Groq(api_key=request.api_key)
            chat_completion = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=model_id,
            )
            polished_markdown = chat_completion.choices[0].message.content
        
        elif model_id in google_models:
            genai.configure(api_key=request.api_key)
            model = genai.GenerativeModel(model_id)
            response = model.generate_content(prompt)
            polished_markdown = response.text

        elif model_id in anthropic_models:
            client = anthropic.Anthropic(api_key=request.api_key)
            message = client.messages.create(
                model=model_id,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}]
            )
            polished_markdown = message.content[0].text

        elif model_id in openai_models:
            client = OpenAI(api_key=request.api_key)
            chat_completion = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=model_id,
                temperature=0.3
            )
            polished_markdown = chat_completion.choices[0].message.content

        else:
            raise HTTPException(status_code=400, detail=f"Invalid provider or model specified: {model_id}")

        md = MarkdownIt()
        polished_html = md.render(polished_markdown)
        
        return {"polished_text_html": polished_html}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        print(f"Generic Polishing Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error polishing text: {str(e)}")

# ... (as funções send_to_slack e send_by_email permanecem as mesmas) ...
@app.post("/integrations/slack")
async def send_to_slack(request: SlackRequest):
    try:
        response = requests.post(str(request.webhook_url), json={"text": request.text})
        response.raise_for_status()
        return {"message": "Successfully sent to Slack!"}
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Failed to send to Slack: {e}")

@app.post("/integrations/email")
async def send_by_email(request: EmailRequest):
    msg = MIMEMultipart()
    msg['From'] = request.smtpEmail
    msg['To'] = request.recipientEmail
    msg['Subject'] = request.subject or "Note from Dictation AI"
    msg.attach(MIMEText(request.html_content, 'html'))

    try:
        server = smtplib.SMTP(request.smtpServer, 587)
        server.starttls()
        server.login(request.smtpEmail, request.smtpPassword)
        server.send_message(msg)
        server.quit()
        return {"message": "Email sent successfully!"}
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="SMTP authentication failed. Check email and password.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error sending email: {e}")