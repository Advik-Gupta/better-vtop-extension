# Better VTOP

A Chrome extension that makes VTOP (vtop.vit.ac.in), the student portal of VIT Vellore, easier to use. It restyles the pages students open most and adds the information VTOP makes you dig for, such as how many classes you can still miss before the next exam.

Everything runs in your browser on top of your own signed-in VTOP session. The extension talks only to vtop.vit.ac.in, and anything it saves stays in Chrome's storage on your device.

## What changes

| Page                              | What Better VTOP does                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home                              | Shows courses with attendance, forthcoming digital assignments, and the CGPA card (optional). Hides the action plan, club events and feedback list. Restyles Spot-light. A button works out how many classes you can miss in each course.                                                         |
| Class Attendance                  | Replaces the table with a planner: classes left and classes you can miss before each exam, an exam by exam view, the full day by day record, and your own marks for planned absences and pending on-duty.                                                                                         |
| Time Table                        | Draws your week with only your own classes, and lists registered courses with credits spelt out and a Contact button for each teacher.                                                                                                                                                            |
| Faculty Info                      | Shows search results as cards with each teacher's photo, department, cabin and e-mail, and redraws the profile page as a contact card with open hours.                                                                                                                                            |
| Digital Assignment Upload         | Adds each course's next due date, colour coded by urgency, and a count of assignments handed in. VTOP's own table and buttons stay.                                                                                                                                                               |
| Marks                             | Replaces the table with a summary for each course: marks evaluated, earned and lost, your score so far, the best total still possible and where you land at your current rate. Opening a course shows every component, what is still to come and what you need to finish on 90, 80, 70, 60 or 50. |
| Grades                            | When you open a course's grade ranges, adds a bar showing every grade's range, where your total fell, how many marks you missed the next grade by, and how you compared with the class mean.                                                                                                      |
| Login                             | Reads the image captcha and fills it in for you. You still check it and press Submit. It learns from your successful logins, on your device. It does nothing when VTOP shows reCAPTCHA.                                                                                                           |
| Any page with a semester dropdown | Picks the current semester for you.                                                                                                                                                                                                                                                               |

Every change can be switched off from the extension's popup, and each redesigned page has a link that brings back VTOP's original view.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the repository folder (the one containing `manifest.json`).
5. Open [vtop.vit.ac.in](https://vtop.vit.ac.in/vtop/) and sign in.

To update, pull the latest code, press the reload arrow on the extension's card in `chrome://extensions`, and refresh VTOP.

The extension also works in other Chromium browsers such as Edge and Brave.

## Using it

- Open **Class Attendance** once so the planner can read your timetable and the academic calendar. It keeps them on your device and refreshes them periodically.
- On the home page, **Calculate can miss** fills in the classes you can still miss without leaving the page.
- Click the extension's icon to switch individual features on or off, or to clear saved plans and cached data.

## How the 75% rule is applied

VTOP checks attendance when each exam starts and rounds the percentage up, so 74.1% counts as 75%. The planner uses the same rule: a course is safe if it will stand at 75% or above when the next exam begins, counting lab sessions as VTOP does.

## Privacy

- No analytics, no tracking, no external servers.
- Requests go only to vtop.vit.ac.in, using the session you are already signed in with.
- Your planned absences, on-duty marks and cached timetable live in `chrome.storage.local` and can be cleared from the popup.

## Disclaimer

Better VTOP is an independent student project. It is not affiliated with or endorsed by VIT.

## Made with ❤️ by

<table>
<tr align="center">
<td>
	<p align="center">
		<img src="https://github.com/Advik-Gupta.png" width="170" height="170" alt="Advik Gupta" style="border: 2px solid grey; border-radius: 50%;">
	</p>
	<p style="font-size:17px; font-weight:600;">Advik Gupta</p>
	<p align="center">
		<a href="https://github.com/Advik-Gupta">
			<img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/>
		</a>
	</p>
</td>
</tr>
</table>

#### AI Disclosure

This project was developed with AI assistance. Claude was used to help with page parsing, the attendance planning logic, interface design, and general development support. All final decisions, integration, and project direction were made by the author.
