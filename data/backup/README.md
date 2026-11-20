# Backup podataka

Svake nedjelje GitHub Action (`.github/workflows/backup.yml`) preuzme cijelo stanje
aplikacije s `https://horvati-vocnjak.vercel.app/api/state` i spremi ga ovdje kao
`stanje-GGGG-MM-DD.json`. Čuva se zadnjih 12 tjedana; starije verzije ostaju u git povijesti.

Sadržaj: originalna stabla i loza, dodana stabla, napomene, podaci o biljkama
(orezano/gnojeno/špricano), pomaknute pozicije, izbrisana stabla i stanje rasporeda radova.

Ručno pokretanje: GitHub → Actions → "Tjedni backup podataka" → Run workflow.
Vraćanje iz backupa radi se ručno (uz pomoć skripte) – podaci se ne vraćaju automatski.
