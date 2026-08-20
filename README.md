# Zeta Meet AI

Prompt for Loveable AI

Build a modern, production-style SaaS web application called Zeta – AI-Powered Meeting Intelligence Platform.

Overview

Zeta is an AI-powered workspace that helps users automatically record, transcribe, summarize, organize, and search online meetings. The platform should have a clean, professional UI inspired by Notion, Slack, and Linear, with a responsive design, smooth animations, and a premium appearance.

---

Landing Page

Create a beautiful landing page that includes:

- Hero section with the title:
  "Zeta – The Complete AI Workspace for Your Meetings"
- Subtitle explaining that Zeta automatically transcribes, summarizes, and organizes meetings.
- Buttons:
  - Get Started
  - Watch Demo
- Feature cards
- Workflow section
- Benefits section
- FAQ section
- Pricing section (Free, Pro, Enterprise)
- Footer with Privacy Policy, Terms of Service, Contact, and Social Links.

---

Authentication

Implement authentication using Google Sign-In (OAuth).

Users should be able to:

- Sign Up
- Sign In
- Log Out
- Reset Password
- Edit Profile

---

Dashboard

After login, show a professional dashboard containing:

- Upcoming Meetings
- Previous Meetings
- AI Summary Cards
- Pending Action Items
- Calendar Widget
- Statistics
  - Total Meetings
  - Hours Saved
  - Tasks Completed
  - AI Summaries Generated

---

Meeting Integration

Provide options to:

- Connect Google Meet
- Connect Microsoft Teams
- Enter a Meeting Link manually

When a meeting starts:

- Join as AI Assistant (UI simulation)
- Show Recording Status
- Show Live Transcript
- Show Active Speakers
- Display Recording Duration

---

Real-Time Transcription

Create a real-time transcript page.

Features:

- Live captions
- Speaker labels
- Timestamps
- Auto-scroll
- Pause/Resume
- Download transcript

---

AI Summary

After the meeting ends, automatically generate:

- Executive Summary
- Key Discussion Points
- Decisions Made
- Risks
- Action Items
- Follow-up Tasks
- Deadlines
- Participants

Display each section in beautiful cards.

---

Meeting Memory

Maintain previous meeting history.

Before every meeting display:

- Previous Summary
- Pending Tasks
- Previous Decisions
- Suggested Agenda

This should appear as an AI-generated briefing.

---

AI Chat

Create a chatbot inside the dashboard.

Users can ask questions such as:

- What was discussed yesterday?
- What decisions were made?
- Who is responsible for Task A?
- Show meetings about authentication.
- Show discussions related to the Zeta Dashboard.

The chatbot should answer using stored meeting transcripts.

---

Search

Provide semantic search.

Users can search by:

- Speaker
- Topic
- Date
- Keyword
- Project

Return relevant meetings with highlighted results.

---

Email Automation

After meeting completion:

Generate a professional email including:

- Meeting Summary
- Action Items
- Decisions
- Next Steps

Provide a "Send via Gmail" button.

---

Calendar

Integrate Google Calendar.

Features:

- Upcoming Meetings
- Join Button
- AI Reminder
- Daily Agenda

---

Notifications

Create notification support for:

- Meeting Started
- Summary Ready
- Action Item Assigned
- Email Sent
- Reminder Notifications

---

User Profile

Display:

- Profile Picture
- Name
- Email
- Company
- Time Zone
- Language
- Connected Accounts
- Subscription Plan

---

Admin Dashboard

Create an admin panel with:

- Total Users
- Active Meetings
- AI Usage Statistics
- Storage Usage
- Revenue Dashboard
- User Management

---

Database Design

Design tables for:

- Users
- Meetings
- Participants
- Transcripts
- Speakers
- AI Summaries
- Action Items
- Decisions
- Emails
- Notifications

---

AI Architecture (UI Simulation)

Prepare the application for future integration with:

- Whisper API for Speech-to-Text
- Large Language Model (OpenAI GPT/Llama/Gemini) for summarization
- Vector Database (FAISS or Pinecone) for semantic search
- RAG (Retrieval-Augmented Generation) for AI chat
- Gmail API
- Google Calendar API

Use placeholder/mock data where live AI services are not connected.

---

UI Theme

Use:

- Glassmorphism
- Rounded cards
- Soft shadows
- Purple and blue gradients
- Modern typography
- Dark mode and Light mode
- Smooth animations
- Responsive design for desktop, tablet, and mobile

The application should look like a premium SaaS product ready for real-world deployment.

Generate all pages, reusable React components, routing, state management, forms, dashboards, mock APIs, and sample data so the application can be demonstrated even without connecting the actual AI services.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ccc1495e-6d55-4bb3-a28c-b974607b2273).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
