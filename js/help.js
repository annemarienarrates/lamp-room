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
        ["Covers", "Click 🖼 on a card (or the cover on a book page) to add a cover image."]
      ] },
    { id: "books", icon: "📖", title: "Books & manuscripts", lead: "A book here is a manuscript you'll record. Each one is linked to a title in the planner.",
      items: [
        ["+ New Project", "Import a Word file (.docx) or paste text. The Lamp Room finds the chapters and counts the words."],
        ["Who reads what", "Highlighted lines in the manuscript become parts (blues, pinks, yellow). The Lamp Room asks who reads each one. You can change it later on the book page."],
        ["Book page", "Chapters with status, words and time; the cast; pay; due date; the schedule badge. Untick a chapter to leave it out (front matter, for example)."],
        ["POV chapters", "If a whole chapter is in your partner's voice, set the POV column on that chapter and it becomes theirs."],
        ["Put on the schedule", "📅 on a card links a book to its title in the planner, so booth time and words count toward that job."]
      ] },
    { id: "booth", icon: "🎙", title: "The Booth: recording", lead: "The manuscript fills the screen, your tracks sit at the bottom. Read, and it follows you.",
      items: [
        ["Record / Pause", "R. Starts recording on the selected track. Press again to pause, again to resume. While recording, the voice wave glows across the bottom of the screen."],
        ["Stop", "S. Finishes the take."],
        ["Follow-along", "With “with listening” ticked, the text lights up as you read and keeps your place. Your lines are bright; your partner's are dimmed, with the line before yours as a grey cue."],
        ["Flub", "F. Made a mistake? Press F: it jumps back to the start of the sentence, plays a little lead-in (pre-roll) and records again over it."],
        ["Punch in", "Shift+R. Records from the playhead, with the pre-roll first. Set the pre-roll length in the bar at the top."],
        ["Markers", "M drops a flub marker to fix later. N drops a named marker (it goes into your WAV export)."],
        ["Two clocks", "Booth time counts the time you spend on the chapter (it pauses after a few idle minutes; click it to pause or start). FH is the finished length of the audio."],
        ["Level check", "🎚 Level: speak at narration volume and aim for the green band."],
        ["Mark complete", "When the chapter's done, press Mark Ch complete. It stops the booth clock, celebrates and offers to export."],
        ["Text size", "A− and A+ in the top bar, ⌘− / ⌘=, or hold ⌘ and scroll over the text. Drag the line above the tracks to make them taller or shorter."],
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
        ["Zoom", "− and = zoom time out and in. [ and ] make tracks shorter or taller."],
        ["Flags", ", and . jump to the previous and next flag. The flag button lists them all."],
        ["Edit the text", "✎ Text editor fixes typos in the manuscript. Select words to change who reads them."],
        ["Export", "Export chapter: WAV, MP3, or raw for Auphonic. File names follow the pattern in Settings."]
      ] },
    { id: "tools", icon: "🎛", title: "Tools panel", lead: "Open it with the Tools tab on the right (or Shift+P). Pick a page from the menu at the top.",
      items: [
        ["👥 Co-narrator", "Duet lines: send yours, bring in your partner's. See Duets below."],
        ["🚩 Pickups", "Every flag in the chapter. Fix goes to the start of that sentence and punches in. ✓ marks it dealt with."],
        ["🎛 Effects", "Pitch, double, reverb, echo, chorus, robot and placement. Preview first, then Apply (Undo brings the original back). Arm keeps an effect on a track so every new take there gets it. E repeats the last effect."],
        ["Track sound", "A live tone chain (rumble cut, warmth, presence, air…). Your recordings aren't changed. Auphonic masters for you, so leave it off unless a track needs its own sound."],
        ["Takes", "Every take on the timeline, with play and delete."],
        ["Levels & checks", "Gain up or down on a selection or take. ACX check measures the chapter: loudness, peaks and room noise."],
        ["Mic & reading", "Choose the microphone, who you're reading as, the theme and the reading font."]
      ] },
    { id: "duets", icon: "👥", title: "Duets", lead: "Whoever narrates the chapter is the lead. The other person records only their lines and sends them over.",
      items: [
        ["If you're not the lead", "Record all your lines straight through, with a breath between them. Then Tools ▸ Co-narrator ▸ 📤 Send my lines. Each line is cut out and lands in the shared folder."],
        ["If you're the lead", "Your partner's lines arrive on their own. Just read: when you finish the line before theirs and go quiet, their line drops in on their track (and plays in your headphones if you like). Wait for “Your turn”, then carry on."],
        ["C", "Drops their next line in by hand, right now. If it hasn't arrived yet, it marks a slot instead. You rarely need it: auto-place usually does it."],
        ["Slots & Splice all", "Lines that weren't there yet leave a slot. When they arrive, Splice all fills every slot at once."],
        ["Wrong reader?", "Select the words in the text and choose who reads them."]
      ] },
    { id: "cele", icon: "✨", title: "Celebrations & combo", lead: "Big glowing words when you earn them.",
      items: [
        ["Celebrations", "Daily word goal, booth hours, earnings, a fast pace, a finished chapter, a finished book. They wait until you stop recording, so they never interrupt a take."],
        ["Combo", "Your own words read without a 10-second break build a combo, with Finished Hour's tier names. Click the meter to hide it."],
        ["Turn them down", "Settings ▸ Look & feel: celebrations, combo, confetti, and Calm (keeps the words, drops the sparks and flashes). These are yours alone."]
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
        ["One booth, two people", "Click 👤 in the top bar (or ☰ Menu in the Booth) and pick who's recording. Switch before you press Record."],
        ["Moving takes home", "Recordings stay on the computer they were made on. Afterwards: Settings ▸ Recordings on this computer ▸ Copy their takes to a folder (a USB stick or Drive). On the other Mac: Bring takes in. Nothing gets overwritten."],
        ["Hotkeys", "⌨ Hotkeys in the Booth: click an action, press the new key."]
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
