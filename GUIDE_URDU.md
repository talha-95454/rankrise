# RankRise — GitHub + Render par Public Link ki Guide

Hugging Face 418 de raha hai, is liye ye doosra rasta hai:
pehle code GitHub par jayega, phir Render usay chala kar public
link de dega. Dono free hain, card nahi chahiye.

## Hissa A — GitHub account
1. Chrome me github.com kholo -> Sign up
2. Email, password aur ek username likho (username soch kar — repo ke link me ayega)
3. Ek halka sa puzzle/verification ayega — hal karke aage barho
4. Email par code ayega, wo daal kar verify kar lo -> account ready

## Hissa B — Repo banao aur files daalo
5. github.com/new kholo
6. Repository name: rankrise -> Public rakho -> Create repository
7. Bane hue page par "uploading an existing file" wale link par click
8. Is package ki SAARI files aur folders drag karke daal do:
   app.py, Dockerfile, requirements.txt, README.md, render.yaml,
   templates (folder), static (folder)
9. Neeche Commit changes dabao

## Hissa C — Render par chalao
10. render.com kholo -> Sign In -> GitHub se login karo (wahi GitHub account, ek click)
11. Dashboard me New + -> Web Service
12. Apni rankrise repository select karo (pehli dafa Render GitHub access mange to Allow kar dena)
13. Settings:
    - Name: rankrise
    - Language/Runtime: Docker (khud select ho jayega)
    - Instance Type: Free
14. Create Web Service dabao
15. Build shuru ho jayegi — kuch minutes me status Live ho jayega
16. Tumhara public link: https://rankrise.onrender.com jesa hoga (jo link screen par dikhe wahi asal hai)

## Note
- Free service 15 minute khaali rehne par "so" jati hai — link kholne par ~1 minute me khud jaag jati hai.
- Tumhari saved apps tumhare Chrome me save hoti hain — hamesha usi Chrome se tool kholna.
- Har step par atko to screenshot bhej dena.
