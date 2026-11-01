# Smart Photocopy — Print Agent (Windows) Setup Guide

## Set up kaise kare (3 minute)

1. **Poora folder extract karo** (`SmartPhotocopyAgent-Windows.zip`) — kisi bhi folder me, e.g. Desktop.
2. Shop Dashboard → **Printers & devices** → pehle apne printers add karo (naam **bilkul wahi likhna jo Windows me dikhata hai**, e.g. `HP LaserJet M1136 MFP`) → phir **Add device** → **pairing code** copy karo.
3. `install.bat` pe **double-click** karo → jab pooche **pairing code paste** karo → bas!
   - Agent khud install ho jayega, SumatraPDF khud download hoga, auto-start lag jayega.
4. **Test:** apni shop QR page se ek chhota order karo → dashboard me UTR verify karo → print nikal aayega.

> Agar dukaan ke PC me internet na ho SumatraPDF ke time: pehle https://www.sumatrapdfreader.org/download-free-pdf-viewer se install karo, phir `install.bat` chalao.

## English quick steps

1. Extract the zip, run `install.bat`, paste the pairing code from Shop Dashboard → Printers & devices.
2. The agent installs to `C:\Program Files\Smart Photocopy Agent` (or your user folder if no admin), auto-starts at logon, and polls for authorized jobs over outbound HTTPS only.
3. Print engine: SumatraPDF (auto-downloaded; manual fallback link above).

## Manual run (advanced)

```
SmartPhotocopyAgent.exe --pair <CODE>     pair with a one-time code
SmartPhotocopyAgent.exe --simulator       test mode (no physical printing)
SmartPhotocopyAgent.exe --once            single poll then exit
SmartPhotocopyAgent.exe                   normal run
```

- Config: `agent.config.json` next to the exe (serverUrl, printerMap, printCommandTemplate).
- State: `agent.state.json` — crash-safe idempotency (never re-prints a completed job after restart).
- Logs: `agent.log`.

## Run as a Windows Service (recommended for busy shops)

Use [NSSM](https://nssm.cc):

```
nssm install SmartPhotocopyAgent "C:\Program Files\Smart Photocopy Agent\SmartPhotocopyAgent.exe"
nssm set SmartPhotocopyAgent AppDirectory "C:\Program Files\Smart Photocopy Agent"
nssm start SmartPhotocopyAgent
```

## Honest behaviour notes

- Job states: DISPATCHED → SPOOLING → SPOOLER_ACCEPTED → PRINTING → COMPLETED/FAILED.
- "COMPLETED" = the Windows spooler accepted and finished the job — it is **not** hardware-confirmed paper output. Check the tray 🙂
- Internet cut? The agent retries with backoff and never loses a job.
- Revoke anytime: Shop Dashboard → Printers & devices → Revoke.
