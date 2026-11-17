/* The Lamp Room — the guide. One source for the ? page in the app and the printable PDF.
   Each section: id, title, a one-line "what it's for", then short items [label, description]. Plain words. */
(function () {
  "use strict";
  const HELP = [
    { id: "start", icon: "🕯", title: "Start here", lead: "The Lamp Room is the recording booth, the editor and the business planner in one Chrome tab.",
      items: [
        ["The top bar", "Dashboard (today), Almanac (calendar), Titles (every job), Log (hours), Ledger (money), Workspace (back to the last book's Booth), Tools, Settings, ? (this guide)."],
        ["👤 Your name", "Top right. It shows who is working at this computer. Click it to switch people when you share one booth. Each person keeps their own theme, hotkeys, sizes, goals and sessions."],
        ["It saves itself", "Every change is saved as you go. A small “Saved” chip flashes. There is no Save button."],
        ["Two folders", "The Library (in the shared Google Drive folder) holds books, titles, the schedule, the ledger and duet lines. Your Studio folder (on your own Mac, outside Drive) holds your recordings."],
        ["Changes from the other Mac", "They appear on their own within about 20 seconds, or when you click back into the window. A chip says “Updated from Anne”."],
        ["Chrome only", "Open it at annemarienarrates.github.io/lamp-room in Google Chrome. If it asks to open the library again, click Open my library and allow."]
      ] },
    { id: "dashboard", icon: "☀", title: "Dashboard", lead: "Your day at a glance. Click the Focus card and you're in the right Booth, on the right chapter.",
      items: [
        ["Focus", "The one thing to do today: the title, the stage (record, edit, proof…), the chapter and the hours the planner set aside. Click it to start."],
        ["Then", "The rest of today's plan, in order."],
        ["Partner line", "One line on what your partner is doing today."],
        ["Heads up", "Anything that needs attention: titles running late, checks due, bills due, money owed between you, a day with no log."],
        ["Rings", "Today's words, booth hours and earnings against your goals."],
        ["Projects", "Every book and title. Switch between cards and a list, and sort them. Archived books fold away at the bottom; open one and press Unarchive to bring it back."],
        ["Finished", "Finished titles fold into a Finished dropdown under the active ones, like Archived."],
        ["Covers", "Click 🖼 on a card (or the cover on a book page) to add a cover image."]
      ] },
    { id: "books", icon: "📖", title: "Books & manuscripts", lead: "A book here is a manuscript you'll record. Each one is linked to a title in the planner.",
      items: [
        ["+ New Project", "Import a Word file (.docx) or paste text. The Lamp Room finds the chapters and counts the words."],
        ["Who reads what", "Highlighted lines in the manuscript become parts (blues, pinks, yellow). The Lamp Room asks who reads each one. You can change it later on the book page."],
        ["Book page", "Chapters with status, words and time; the cast; pay; due date; the schedule badge. Untick a chapter to leave it out (front matter, for example)."],
        ["Fix chapters", "Book page ▸ a chapter's Text button: ✂ at any paragraph starts a new chapter there (e.g. “Previously” hiding in the front matter; tick In to include it). ⤓ Merge joins a chapter to the next."],
        ["Update the manuscript", "Book page ▸ Details ▸ Update the manuscript… Choose the corrected .docx: chapters are matched by title, and you tick which ones take the new text. Recordings, notes and status stay. Missing chapters are added."],
        ["POV chapters", "If a whole chapter is in your partner's voice, set the POV column on that chapter and it becomes theirs."],
        ["Put on the schedule", "📅 on a card links a book to its title in the planner, so booth time and words count toward that job."]
      ] },
    { id: "booth", icon: "🎙", title: "The Booth: recording", lead: "The manuscript fills the screen, your tracks sit at the bottom. Read, and it follows you.",
      items: [
        ["Record / Pause", "R. Starts recording on the selected track, always from the end of the last clip in the chapter, whatever track that clip is on. Press again to pause, again to resume. While recording, the voice wave glows across the bottom of the screen."],
        ["Stop", "S. Finishes the take."],
        ["Follow-along", "With “with listening” ticked, the text lights up as you read and keeps your place. Your lines are bright; your partner's are dimmed, with the line before yours as a grey cue."],
        ["Flub", "F. Made a mistake? Press F: it jumps back to the start of the sentence, plays a little lead-in (pre-roll) and records again over it."],
        ["Punch in", "Shift+R. Records from the playhead instead, with the pre-roll first. Set the pre-roll length in the bar at the top."],
        ["Markers", "M drops a flub marker to fix later. N drops a named marker (it goes into your WAV export)."],
        ["Two clocks", "Booth time counts the time you spend on the chapter (it pauses after a few idle minutes; click it to pause or start). FH is the finished length of the audio."],
        ["Level check", "🎚 Level: speak at narration volume and aim for the green band."],
        ["Mark complete", "When the chapter's done, press Mark Ch complete. It stops the booth clock, celebrates and offers to export."],
        ["Text size", "A− and A+ in the top bar, ⌘− / ⌘=, or hold ⌘ and scroll over the text. Drag the line above the tracks to make them taller or shorter."],
        ["↓ and ↑", "Jump to the start of your next line, or back to your previous one. Not recording, the playhead follows if that line is recorded."],
        ["Chapters", "The Chapters tab on the right lists every chapter with words left and time spent. Click one to jump to it."]
      ] },
    { id: "editing", icon: "✂", title: "The Booth: editing", lead: "The tracks at the bottom are a full editor. Nothing is ever lost: Undo goes back step by step.",
      items: [
        ["Select", "Drag across the waveform to select. Click to place the playhead. ⌘A selects the whole chapter."],
        ["Takes", "Each recording is a take. Click a take's label strip to select it. Drag the strip (or hold ⌥ and drag) to move it."],
        ["Cut, copy, paste", "⌘X, ⌘C, ⌘V. Paste inserts at the playhead and pushes the rest along. Paste over (⌘⇧V) replaces what's there."],
        ["Delete", "Delete removes the selection, or the selected take. If nothing else plays under it, the gap closes."],
        ["Split", "B splits the take at the playhead."],
        ["Tracks", "T moves to the next track, Shift+T adds one. 1–6 pick a track. ⌥1–6 records straight onto that track (handy for a character voice)."],
        ["Zoom", "− and = (or the − + buttons on the timeline, or ⌘-scroll) zoom time out and in. ⤢ Fit shows the whole chapter. [ and ] make tracks shorter or taller."],
        ["Flags", ", and . jump to the previous and next flag. The flag button lists them all."],
        ["Edit the text", "✎ Text editor fixes typos in the manuscript. Select words to change who reads them."],
        ["Trim and space", "Drag either edge of a take. Everything after it moves along on every track: drag in to tighten a pause, out to open it. Red shows what's coming out, teal the space opening, with a live ± seconds readout. Hold ⌥ to trim just that take. Edges snap to other takes and markers."],
        ["Fades", "Drag the small white dots at a take's bottom corners, or type fade lengths in Tools ▸ Levels, fades & spacing. Every cut already gets a tiny fade so it never clicks."],
        ["Add space", "G adds half a second (or your length) at the playhead, filled with your room tone."],
        ["Export", "Export chapter: WAV, MP3, or raw for Auphonic. File names follow the pattern in Settings."]
      ] },
    { id: "tools", icon: "🎛", title: "Tools panel", lead: "Open it with the Tools tab on the right (or Shift+P). Pick a page from the menu at the top.",
      items: [
        ["📼 Finished audio", "A book that's already recorded, or a narrator's chapters for cast assembly: bring it in, map it, find words in it, replace bits. See Finished audio below."],
        ["👥 Co-narrator", "Duet lines: send yours, bring in your partner's. See Duets below."],
        ["🚩 Pickups", "Every flag in the chapter. Fix goes to the start of that sentence and punches in. ✓ marks it dealt with."],
        ["⤓ Export checks", "The Export dialog has two ticks it remembers for you: Proof the chapter (lists any misreads first: Review them, or Export anyway) and Even out pauses (your head, heading, scene-break, tail and gap settings)."],
        ["🔎 Proofing", "Settings ▸ Proofing while I read, per person: Off, When I stop (each take is checked), or Live (every ~20 s). Misreads are underlined in red in the text and listed in Pickups. Always ignore stops a name being flagged again in that book."],
        ["🎛 Effects", "Pitch, double, reverb, echo, chorus, robot and placement. Preview first, then Apply (Undo brings the original back). Arm keeps an effect on a track so every new take there gets it. E repeats the last effect."],
        ["🎚 Track sound", "A live tone chain (rumble cut, warmth, presence, air…). Your recordings aren't changed. Auphonic masters for you, so leave it off unless a track needs its own sound."],
        ["🎞 Takes", "Every take on the timeline, with play and delete."],
        ["📏 Levels, fades & spacing", "Fades, Add space, room tone, Even out pauses, gain, and the ACX check (loudness, peaks, room noise)."],
        ["Room tone", "Learn it once per book: select a quiet pause, or let it find one. Gaps, added space and the tail then fill with your room instead of dead silence."],
        ["Even out pauses", "Head 0.8 s, 2 s after the chapter heading, 1.5 s at scene breaks, 3.5 s tail, and any other pause over 0.7 s brought down to 0.7 (shorter ones left alone). Preview first, or tick it to happen when you mark a chapter complete. Change the lengths there too."],
        ["🎙 Mic & reading", "Choose the microphone, who you're reading as, the theme and the reading font."]
      ] },
    { id: "duets", icon: "👥", title: "Duets", lead: "Whoever narrates the chapter is the lead. The other person records only their lines and sends them over.",
      items: [
        ["If you're not the lead", "Record all your lines straight through, with a breath between them, and press C at the end of each one: the cutter splits exactly there. Then Tools ▸ Co-narrator ▸ 📤 Send my lines. Each line is cut out and lands in the shared folder."],
        ["If you're the lead", "Your partner's lines arrive on their own. Just read: when you finish the line before theirs and go quiet, their line drops in on their track (and plays in your headphones if you like). Wait for “Your turn”, then carry on."],
        ["Don't want to wait?", "Just keep reading while their line plays (or press Space). Their line keeps its place and what you read lands after it, so you never record over them."],
        ["Flub after their line", "F goes back to your sentence and keeps their line whole in front of it. If you flub before their line, their line comes out and drops in again when you get there."],
        ["Re-sent lines", "If your partner re-cuts and sends lines you've already placed, Tools ▸ Co-narrator shows “Swap them in”. Each one replaces the old in place."],
        ["Headphone bleed", "Tools ▸ Co-narrator ▸ While their lines play: turn their volume down, and leave “Clean up my track under their lines” on. It swaps your track for room tone while they speak, and stops the moment you start."],
        ["Fix a splice", "Click their line on its track. A small editor opens: hear it in place, move the start or end by 50 ms, nudge it, re-cut it from what they sent, or remove it. The chapter moves along with every change. Older lines (sent before the spare edges were added) can be trimmed but not extended."],
        ["Fix it at the source", "If you read the partner's lines: open the chapter, put the playhead where a line really ends, press C to drop a cut mark, and Send again. The lead gets “Swap them in”."],
        ["C", "Drops their next line in by hand, right now. If it hasn't arrived yet, it marks a slot instead. You rarely need it: auto-place usually does it."],
        ["Slots & Splice all", "Lines that weren't there yet leave a slot. When they arrive, Splice all fills every slot at once."],
        ["Wrong reader?", "Select the words in the text and choose who reads them."]
      ] },
    { id: "finished", icon: "📼", title: "Finished audio: corrections & assembly", lead: "Open a book that's already recorded, or a chapter someone else narrated, and work on it in the Booth like any other.",
      items: [
        ["Bring it in", "Import the manuscript as usual, then Tools ▸ 📼 Finished audio ▸ Bring in the whole book. Choose one file per chapter (MP3, M4A or WAV); they're matched to chapters in name order and you confirm first. Each chapter opens on its timeline when you go to it."],
        ["Corrections book", "Tick it and nothing you read counts as words: your pickups count as booth time only."],
        ["Map it", "Map the book listens through the audio on this computer and pins the text to it. It takes a while on a long book, so start it and get on with something else. Stop and pick up later any time."],
        ["Find in the audio", "Type a word or name (the Japanese words, a character's name) and you get every place it appears, with times once mapped. Click one to jump there."],
        ["Replace a bit", "Drag across what's wrong on the waveform, press Replace the selection, read the fix, press S. The chapter closes up to fit, and the new read is matched to the loudness around it. For a character's new voice, record on another track with its own effects."],
        ["Assembling as cast", "When someone else narrates: 1) read your own lines as yourself and press 📤 Send my lines (Jack does the same). 2) Finished audio ▸ 🧩 Assemble this chapter: the timeline becomes the narrator's, so bring in their chapter audio and map it. 3) Outside cast come in as their files in Co-narrator. 4) Splice all drops every line into place, then export the chapter. Your booth time counts as yours; no words count while assembling. ← Back to my lines returns you to reading."],
      ] },
    { id: "cast", icon: "🎭", title: "Full cast & pickups", lead: "Up to six voices, and re-reads that travel between you without a single email.",
      items: [
        ["Full cast", "Highlight each voice in its own colour with Word's highlighter, in this order: Turquoise (main male), Pink (main female), Bright green, Gray 25%, Yellow, Red. Narration stays unhighlighted. On import, tick Full cast and every colour becomes its own part. It switches on by itself when a file has four or more colours."],
        ["Cast 1–4", "Outside cast don't need the Lamp Room. Give their colour to Cast 1, Cast 2… on import or on the book page."],
        ["Their file", "Tools ▸ Co-narrator ▸ 🎧 Cast 2's file… Drop in what they sent (WAV, MP3, M4A, AIFF, FLAC). It's cut into their lines and auto-placed as you read, like your partner's. Tick “runs on into the next chapters” for a file that covers several."],
        ["Matched by their words", "With the proofer on hand, every stretch in their file is listened to and matched to its line: a retake replaces the earlier read, and a skipped line is flagged as missing. Co-narrator ▸ Mark as pickups puts the missing ones on their list. (Untick “Match lines by their words” to go by order.)"],
        ["Clicks or pauses", "Best: ask cast to click or clap once between lines, and to redo a flubbed line before the click (the last read is kept). With no clicks, the pauses decide, which works for clean reads. Lines marked “check” deserve a listen."],
        ["Ask for a pickup", "Lead only. Click 🔁 on a line in Co-narrator, or select its words in the text. Add a note if you like."],
        ["Your partner gets it", "It shows on their Dashboard (Heads up) and in their Booth. They open Tools ▸ Pickups, press 🎙 Record, read it (R to record, S to stop), listen, and Send."],
        ["It goes in by itself", "When their pickup arrives, it replaces the old read in your chapter the moment you open it. The timeline grows or shrinks to fit. Undo takes it out."],
        ["Pickups from cast", "Pickups ▸ 📋 Copy the list, and send it to them. When their file comes back, 🎧 Drop in their pickups: cut at the clicks, each one goes in."]
      ] },
    { id: "cele", icon: "✨", title: "Celebrations & combo", lead: "Big glowing words when you earn them.",
      items: [
        ["Celebrations", "Daily word goal, booth hours, earnings, a fast pace, a finished chapter, a finished book. They wait until you stop recording, so they never interrupt a take."],
        ["Combo", "Your own words read without a 10-second break build a combo, with Finished Hour's tier names. Click the meter to hide it."],
        ["Turn them down", "Settings ▸ Look & feel: celebrations, combo, confetti, and Calm (keeps the words, drops the sparks and flashes). These are yours alone."]
      ] },
    { id: "goals", icon: "🎯", title: "Goals", lead: "Am I on track today, this week, this month, this year? And what would it take to catch up?",
      items: [
        ["Who", "Both of us, Anne or Jack, at the top. Each has a yearly goal; Both of us uses the revenue goal from Settings ▸ Planning & money."],
        ["Where you're at", "Today, this week, this month and this year, each with a bar, a tick where the goal expects you by yesterday, and On track, Ahead or Behind by $X."],
        ["Today's target", "Dollars, booth hours, finished hours and words for today. Remaining workdays rises if you fall behind and eases off when you're ahead; Same every day doesn't move."],
        ["Catch-up plan", "What you'd need to average over the next 30 workdays (or your number) to bring the year back on pace, next to what you've been averaging."],
        ["Charts", "The year (earned against the goal's pace, and checks received), 30 or 90 days of words, booth hours and pace, earnings by month, and a year of activity. Hover for numbers."],
        ["Earned", "The value of what you've recorded: each session's words × what that title pays per word. The Year's Reckoning (checks received and forecast) sits at the bottom."]
      ] },
    { id: "planner", icon: "📅", title: "The planner (Ledger & Lamp)", lead: "The business side. It schedules every stage of every title around your hours, days off and holidays.",
      items: [
        ["Almanac", "The calendar. Each day shows who's doing what. “Today I…” logs your day in a sentence. The year's reckoning sits at the bottom."],
        ["Titles", "One card per job: client, pay, due date, stages and who does each, money, star, check received. The Pipeline holds maybes that aren't booked yet. 📖 opens the book."],
        ["Log", "Your hours. Read my note turns a free-written note into log lines (with an API key; without one, a simple reader does it and you check). Log by hand: title, stage, hours. Booth time is already filled in from recording. Days off live here too."],
        ["Ledger", "Money by month: checks, royalties, bills, partner payouts and the running balance. Download the year as a spreadsheet (CSV)."],
        ["The Key", "How the planner thinks: stages, paces, turnaround, colours. Open it from the button at the end of this guide."],
        ["Planning & money settings", "Settings ▸ Planning & money: hours, workdays and paces for each of you, turnaround times, goals and holidays."]
      ] },
    { id: "sharing", icon: "⇄", title: "Sharing & settings", lead: "What's yours, what's shared, and how to share one booth.",
      items: [
        ["Shared by both", "Books, titles, the schedule, the log, the ledger, narrators and paces, export names."],
        ["Yours alone", "Theme, reading font, celebrations, combo, confetti, earnings goal, hotkeys, text size, track height, zoom, pre-roll. Kept per person on each computer."],
        ["Writing and audio", "The Dashboard and Titles keep audio projects and writing projects in separate sections."],
        ["One booth, two people", "Click 👤 in the top bar (or ☰ Menu in the Booth) and pick who's recording. Switch before you press Record."],
        ["Moving takes home", "Recordings stay on the computer they were made on. Afterwards: Settings ▸ Recordings on this computer ▸ Copy their takes to a folder (a USB stick or Drive). On the other Mac: Bring takes in. Nothing gets overwritten."],
        ["Hotkeys", "⌨ Hotkeys in the Booth: click an action, press the new key."],
        ["Notices", "Settings ▸ Look & feel ▸ Notices. Warnings always show. Nothing else interrupts a take: it waits until you stop. Confirmations (“copied”, “marker dropped”) are off unless you switch them on. Duet cues can be big, small or off. The voice wave can be switched off there too."]
      ] },
    { id: "trouble", icon: "🔧", title: "If something's off", lead: "",
      items: [
        ["It asks for the folder again", "Chrome forgets permission after a restart. Click Open my library and Allow."],
        ["No microphone", "Tools ▸ Mic & reading ▸ choose the microphone. Check Chrome's mic permission (the icon in the address bar)."],
        ["Partner's changes don't show", "Make sure Google Drive is running and the Lamp Room Library folder is set to Available offline (Mirror files)."],
        ["A take won't play on this Mac", "It was recorded on the other computer. Bring the takes in (see Sharing)."],
        ["Made a mess", "⌘Z. Undo goes back step by step, in the Booth and the editor."]
      ] }
  ];
  window.LRHelp = { HELP };
})();
