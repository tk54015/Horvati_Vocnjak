// Jednokratna revizija povrća (studeni 2026.) prema stručnoj provjeri.
// - "dobri/loši susjedi" zamijenjeni s "pogodne kombinacije" i "na što paziti"
// - ispravke: vršna trulež, lubenica, češnjak, kukuruz, patlidžan, mrkvina muha...
// - opći savjeti (tlo, plodored, kalenje, voda, malč, skladištenje)
// ID-jevi ostaju isti. Pokretanje: node scripts/revizija-povrce-2026-11.cjs
const fs = require('fs');
const path = 'data/povrce.json';
const d = JSON.parse(fs.readFileSync(path, 'utf8'));

d.meta.napomena = 'Kalendar je okviran za kontinentalnu Hrvatsku (okolica Zagreba): stvarni rok ovisi o temperaturi tla, vremenu, sorti i tome sije li se izravno ili sade presadnice. Ledeni sveci (sredina svibnja) dobar su orijentir za toploljubivo povrće, ali ne jamstvo da više neće biti mraza: saditi kad su i noći dovoljno tople. Glinasto tlo u proljeće se sporije zagrijava i ne smije se obrađivati dok je mokro.';
d.meta.savjeti = [
  { naslov: '🟫 Glinasto tlo', tekst: 'Ne obrađivati tlo dok je mokro (ako se zemlja lijepi i mijesi u kuglu, pričekati), jer se tako stvara zbijen sloj. Svake godine dodati zreli kompost i postupno poboljšavati strukturu; povišene gredice brže se prosuše i zagriju u proljeće. Rano proljetne kulture saditi na dijelove vrta koji se najprije suše.' },
  { naslov: '🔄 Plodored', tekst: 'Istu ili srodnu porodicu ne saditi na istu gredicu 3–4 godine; nije dovoljno samo pomaknuti biljku na drugi kraj iste gredice. Glavne skupine: pomoćnice (rajčica, paprika, patlidžan, krumpir), tikvenjače (krastavac, tikvica, bundeva, lubenica), kupusnjače (kupus, rotkvica), lukovi (luk, češnjak, poriluk), štitarke (mrkva, peršin), mahunarke (grah, grašak), lobode (cikla, blitva, špinat), salata i kukuruz.' },
  { naslov: '🌤️ Kalenje presadnica', tekst: 'Presadnice iz kuće 7–10 dana prije sadnje postupno privikavati na vanjske uvjete: prvih dana nekoliko sati u hladu i zavjetrini, pa sve dulje i na suncu, a noću unijeti. Bez kalenja biljke često dobiju ožegotine od sunca i zastanu u rastu.' },
  { naslov: '💧 Zalijevanje', tekst: 'Ne zalijevati po fiksnom rasporedu, nego provjeriti vlagu tla prstom na 5–10 cm. Mlade biljke i tek posijane gredice trebaju češće, ali manje vode; u cvatnji i razvoju plodova najvažnija je ravnomjerna vlaga. Zalijevati ujutro, uz korijen, ne po listu. Na glinastom tlu voda se dugo zadržava, pa je prelijevanje česta greška.' },
  { naslov: '🍂 Malčiranje', tekst: 'Najviše koristi imaju rajčica, paprika, tikvenjače, krumpir i lisnato povrće ljeti. Malč (slama, pokošena osušena trava) postaviti kad se tlo ugrije (krajem svibnja–lipnja), ne prerano u proljeće jer hladi tlo. Na mjestima s puževima malč im pruža skrovište.' },
  { naslov: '📦 Skladištenje', tekst: 'Luk i češnjak: dobro osušiti, čuvati suho i prozračno. Krumpir: u mraku, hladno (4–8 °C) i ne uz jabuke. Bundeva: nakon dozrijevanja na suncu čuvati na 10–15 °C, suho. Mrkva, cikla, peršin: u vlažnom pijesku u hladnom podrumu ili u zemlji pod malčem.' }
];

const V = (id) => {
  const v = d.vrste.find(x => x.id === id);
  if (!v) throw new Error('Nema vrste ' + id);
  return v;
};
const set = (id, patch) => Object.assign(V(id), patch);

set('mrkva', {
  sadnja: [3, 4, 5, 6],
  opis: 'Korjenasto povrće koje se sije izravno na gredicu. Rana sjetva ožujak–prva polovica travnja; za zimsko čuvanje najpouzdanija je sjetva od druge polovice travnja do svibnja. Lipanjska sjetva samo za sorte kraće vegetacije.',
  problemi: 'Mrkvina muha (tamni hodnici u korijenu): najpouzdanija zaštita je mreža sitnih okaca preko gredice odmah nakon sjetve; sjetva uz luk nije zajamčena zaštita.',
  kombinacije: 'rotkvica u istom redu (brzo nikne i označi red), salata između redova',
  pazi: 'peršin i druge štitarke: ista porodica i ista mrkvina muha; plodored'
});
set('luk', {
  opis: 'Najjednostavnije se uzgaja iz lučice. Proljetna sadnja daje luk za čuvanje; za jesensku sadnju (rujan–listopad) koristiti lučicu sorti namijenjenih ozimom uzgoju.',
  voda: 'Umjereno dok luk raste; zalijevanje smanjiti tek kad se lišće počne prirodno sušiti.',
  problemi: 'Plamenjača luka u vlažnim godinama, hrđa, tripsi (srebrnaste pjege na listu) i lukova muha. Ne saditi luk na isto mjesto svake godine.',
  kombinacije: 'mrkva, cikla, salata (različito korijenje i oblik rasta)',
  pazi: 'češnjak i poriluk: ista porodica i iste bolesti; luk ne podnosi zasjenjivanje i korov'
});
set('cesnjak', {
  opis: 'Glavni termin je jesenska sadnja (listopad–studeni). Proljetna sadnja (veljača–ožujak) je moguća; veličina glavica ovisi o sorti i o tome je li češnjak prošao dovoljno hladnoće.',
  sjetva: 'Češnjeve saditi vrhom prema gore, s otprilike 5–7 cm zemlje iznad češnja (prilagoditi veličini češnja i tlu), 10–15 cm razmaka, redovi 25–30 cm.',
  voda: 'Dovoljno vlage tijekom aktivnog rasta i formiranja glavice (travanj–svibanj) u sušnom proljeću; zalijevanje smanjiti 2–3 tjedna pred vađenje.',
  njega: 'Plijevljenje. Kod sorti koje razvijaju cvjetnu stapku, ukloniti je kad se počne savijati (glavice budu veće).',
  kombinacije: 'mrkva, rajčica, jagoda (malo prostora, nizak rast)',
  pazi: 'luk i poriluk: ista porodica i iste bolesti (hrđa); mokro tlo'
});
set('krumpir', {
  sjetva: 'Kad se tlo ugrije na oko 8 °C i dovoljno prosuši (na glinastom tlu ne saditi u mokru, zbijenu zemlju): 10 cm duboko, 30–35 cm u redu, 60–70 cm između redova.',
  njega: 'Ogrnuti kad biljke narastu 15–20 cm, a po potrebi ponoviti, da gomolji ne pozelene.',
  problemi: 'Krumpirova plamenjača (smeđe mrlje na lišću i trulež gomolja) ozbiljna je u kišnim ljetima: pratiti vrijeme i lišće, saditi otpornije sorte. Krumpirova zlatica: skupljati ručno odrasle i narančaste ličinke.',
  kombinacije: 'grah (različita visina), kupus u susjednom redu',
  pazi: 'rajčica, paprika i patlidžan: ista porodica (pomoćnice) i iste bolesti, posebno plamenjača; plodored',
  berbaOpis: 'Rani lipanj–srpanj; kasni kolovoz–rujan, 2–3 tjedna nakon što se cima osuši, kad pokožica gomolja očvrsne (ne guli se trljanjem). Prije spremanja kratko prosušiti u hladu; čuvati u mraku i hladnom.'
});
set('rajcica', {
  sjetva: 'Sjeme u zatvorenom (20–25 °C) od sredine ožujka; ako nema dovoljno svjetla, ranija sjetva daje izdužene presadnice. Prije sadnje 7–10 dana kaliti. Van saditi kad su i noći tople (obično druga polovica svibnja), dublje nego što je raslo (razvije dodatno korijenje), 50–60 cm razmaka, uz kolac.',
  unutra: [3],
  njega: 'Vezati uz kolac. Kod visokih (indeterminantnih) sorti uklanjati zaperke; grmolike sorte ne zakidaju se. Donje listove uklanjati umjereno (one koji dodiruju tlo), ne previše jer plodovi mogu dobiti ožegotine.',
  problemi: 'Plamenjača (smeđe mrlje na listu i plodu u kišnom vremenu), siva plijesan i alternarijska pjegavost; povremeno bakterijske i virusne bolesti. Vršna trulež (tamna mrlja na vrhu ploda) je fiziološki poremećaj: plod ne dobije dovoljno kalcija, najčešće zbog neravnomjerne vlage, a ne nužno zato što u tlu nema kalcija. Zaražene listove ukloniti; prskati tek ako se bolest širi.',
  kombinacije: 'bosiljak, salata i peršin uz rub (nisko, ne zasjenjuju)',
  pazi: 'krumpir, paprika i patlidžan: ista porodica i ista plamenjača; plodored. Kiša po lišću pogoduje plamenjači.'
});
set('paprika', {
  sjetva: 'Sjeme u zatvorenom (22–28 °C) veljača–ožujak. Kaliti 7–10 dana, van kad su noći tople (krajem svibnja), 40–50 cm razmaka ovisno o bujnosti sorte.',
  problemi: 'Lisne uši, tripsi, stjenice; povremeno bakterijske i virusne bolesti. Vršna trulež: kao kod rajčice, nedostatna opskrba ploda kalcijem, najčešće zbog neravnomjerne vlage.',
  kombinacije: 'bosiljak, luk, mrkva uz rub gredice',
  pazi: 'rajčica, krumpir i patlidžan: ista porodica; plodored'
});
set('patlidzan', {
  sjetva: 'Sjeme u zatvorenom (25 °C) veljača–ožujak. Kaliti 7–10 dana; van tek kad je vrijeme stabilno toplo (i noći), obično krajem svibnja ili početkom lipnja, 50–60 cm razmaka.',
  njega: 'Poduprijeti kolcem. Na slabijoj biljci ili u hladnijem ljetu korisno je ograničiti broj plodova; zdrava biljka može nositi i više.',
  problemi: 'Vrlo osjetljiv na hladnoću. Krumpirova zlatica rado napada patlidžan; lisne uši i grinje u suhom ljetu.',
  kombinacije: 'grah, bosiljak',
  pazi: 'krumpir, rajčica i paprika: ista porodica i zajednički štetnici (zlatica)'
});
set('krastavac', {
  sjetva: 'Izravno van sredinom svibnja–lipanj (tlo toplije od 15 °C) ili presadnice u travnju, svaka u zasebnoj posudici jer ne voli oštećivanje korijena; pažljivo presaditi i prije toga kaliti. Penjače voditi na mrežu.',
  voda: 'Puno i redovito, po mogućnosti ujutro uz korijen. Gorčina plodova ovisi o sorti i stresu biljke (suša, vrućina).',
  problemi: 'Plamenjača krastavca (žute uglate pjege na listu), pepelnica krajem ljeta, lisne uši i paukove grinje u suhom vremenu.',
  kombinacije: 'grah, kukuruz (krastavac se penje), kopar, salata',
  pazi: 'tikvica, bundeva i lubenica: ista porodica i iste bolesti (pepelnica, plamenjača); plodored'
});
set('tikvica', {
  opis: 'Vrlo rodna; za obitelj su obično dovoljne 2–4 biljke, ovisno o tome koliko se tikvica jede.',
  sjetva: 'Izravno van u svibnju ili presadnice u travnju; oko 1 m razmaka za grmolike sorte, bujnije trebaju više.',
  problemi: 'Pepelnica na lišću od kasnog ljeta. Na početku zaražene listove ukloniti; kad je biljka pri kraju vegetacije, to nema velikog smisla.',
  kombinacije: 'kukuruz, grah, luk',
  pazi: 'krastavac, bundeva i lubenica: ista porodica i ista pepelnica; tikvica treba puno prostora'
});
set('bundeva', {
  sjetva: 'Izravno van nakon mrazeva (svibanj) ili presadnice u travnju. Razmak ovisi o sorti: 1,5–2 m, a za bujne puzave sorte i više.',
  problemi: 'Pepelnica krajem ljeta: manje utječe na već formirane plodove, ali slabi biljku i može smanjiti kvalitetu dozrijevanja.',
  kombinacije: 'kukuruz i grah (bundeva pokriva tlo ispod njih)',
  pazi: 'krastavac, tikvica i lubenica: ista porodica; bundeva zasjenjuje sve oko sebe'
});
set('lubenica', {
  sjetva: 'Presadnice u travnju u posudicama iz kojih se sade bez oštećivanja korijena, ili izravno van krajem svibnja kad je tlo toplo (iznad 15 °C). Razmak 1–1,5 m.',
  voda: 'Umjerena i stabilna vlaga, posebno dok plodovi rastu. Jako uskraćivanje vode pred zrenje ne jamči slađe plodove, a može smanjiti veličinu i kvalitetu.',
  njega: 'U kraćoj sezoni korisno je ostaviti manje plodova (npr. 2–3) za krupnije plodove, ovisno o sorti i snazi biljke. Ispod ploda staviti dasku ili slamu.',
  kombinacije: 'kukuruz (vjetrobran), rotkvica kao brza međukultura',
  pazi: 'krastavac, tikvica i bundeva: ista porodica; fuzarijsko venuće (ne saditi tikvenjače na isto mjesto)',
  berbaOpis: 'Kolovoz–rujan. Znakovi zrelosti: osušena vitica uz plod, žuta mrlja na kojoj leži, mukao zvuk na kucanje. Nijedan znak nije potpuno pouzdan sam za sebe, pa gledati sve zajedno.'
});
set('grah', {
  opis: 'Niski grah (mahunar) ne treba potporu; visoki (penjač) treba kolce ili mrežu. U simbiozi s bakterijama veže dušik iz zraka, pa ne treba dušično gnojivo (previše dušika daje lišće na štetu mahuna); to ne znači da tlo poslije njega automatski ostaje bogato dušikom.',
  polozaj: 'Sunce; bez dodatnog dušičnog gnojenja.',
  problemi: 'Lisne uši, antraknoza i bakterijske pjegavosti u vlažnom vremenu. Grahov žižak u spremljenom zrnu: dobro osušeno zrno zamrznuti nekoliko dana pa čuvati suho.',
  kombinacije: 'kukuruz (visoki grah se penje uz njega), tikve, krastavac',
  pazi: 'grašak: ista porodica (mahunarke); plodored'
});
set('grasak', {
  opis: 'Jedno od prvih proljetnih povrća; podnosi slabi mraz, a ne voli vrućinu. Za odgovarajuće sorte i povoljan položaj moguća je i jesenska sjetva.',
  sjetva: 'Izravno van čim se tlo može obrađivati (u toplijem proljeću i krajem veljače, inače ožujak–travanj), 3–4 cm duboko, 5 cm u redu.',
  polozaj: 'Sunce do polusjena; visoke sorte uz mrežu ili granje, niske ne trebaju potporu.',
  njega: 'Potpora za visoke sorte.',
  kombinacije: 'mrkva, rotkvica, salata (rano proljeće, malo prostora)',
  pazi: 'grah: ista porodica (mahunarke); plodored'
});
set('salata', {
  sjetva: 'Presadnice od veljače ili izravno van od ožujka. Sjeme sijati vrlo plitko (jedva pokriti); neke sorte slabije niču na visokim temperaturama, pa ljeti sijati u hladnijem dijelu dana ili u polusjeni. Razmak 25–30 cm.',
  problemi: 'Puževi: ručno skupljati navečer, ukloniti skrovišta (daske, gust korov), zaštititi mlade biljke. Lisne uši. Za ljeto birati sorte otporne na prorastanje u cvat.',
  kombinacije: 'mrkva, rotkvica, luk, krastavac (salata brzo raste između sporijih kultura)',
  pazi: 'ljeti joj treba djelomična sjena; ne saditi tamo gdje se puževi skrivaju'
});
set('kupus', {
  opis: 'Rani kupus (presadnice od veljače) bere se ljeti, a kasni (za kiseljenje i zimu) sadi se početkom ljeta i bere u jesen. Rokovi ovise o sorti.',
  problemi: 'Gusjenice kupusova bijelca (pregledavati naličje lista), kupusna muha (vene mlada biljka), buhači na mladim biljkama. Mreža je dobra preventivna mjera, ali je postaviti odmah nakon sadnje, da štetnici ne ostanu ispod nje.',
  kombinacije: 'celer, kopar, luk, salata',
  pazi: 'rotkvica i druge kupusnjače: ista porodica i isti štetnici (buhači, kupusna muha); plodored',
  berbaOpis: 'Rani lipanj–kolovoz; kasni rujan–studeni. Podnosi slabije mrazeve, a otpornost ovisi o sorti i razvijenosti glavice.'
});
set('blitva', {
  sjetva: 'Izravno van travanj–srpanj (kasnija sjetva za jesensku berbu), 2–3 cm duboko, prorijediti na 25–30 cm.',
  njega: 'Brati vanjske listove, srce ostaviti da raste dalje. U blažim zimama može prezimiti, ali na jačem mrazu ne preživi svaka biljka.',
  kombinacije: 'grah, luk, kupus, salata',
  pazi: 'cikla i špinat: ista porodica (lobode); plodored'
});
set('spinat', {
  sadnja: [3, 4, 8, 9, 10],
  berba: [3, 4, 5, 10, 11],
  opis: 'Povrće hladnijeg dijela godine; u dugim i vrućim danima brzo potjera u cvat. Jesenska sjetva često je zahvalnija od proljetne i daje kvalitetniji list; može i prezimiti.',
  sjetva: 'Izravno van ožujak–travanj i kolovoz–listopad (ovisno o sorti i vremenu), 2–3 cm duboko, redovi 20–25 cm.',
  kombinacije: 'rotkvica, salata, grašak',
  pazi: 'cikla i blitva: ista porodica (lobode); vrućina i dugi dan',
  berbaOpis: 'Proljetni travanj–svibanj (u toplom proljeću brzo ide u cvat); jesenski listopad–studeni, prezimljeni u ožujku.'
});
set('rotkvica', {
  opis: 'Najbrže povrće: berba već 4–6 tjedana nakon sjetve, pa je odlična međukultura između sporijih kultura.',
  problemi: 'Buhači (rupičasto lišće) u suhom vremenu; pomaže zalijevanje i mreža postavljena odmah nakon sjetve.',
  kombinacije: 'mrkva, salata, grašak, špinat (rotkvica se izvadi prije nego oni narastu)',
  pazi: 'kupus i druge kupusnjače: ista porodica i isti buhači; plodored'
});
set('cikla', {
  sjetva: 'Izravno van kad se tlo ugrije (travanj–lipanj), 2–3 cm duboko. „Sjeme” je zapravo plodna jedinica s više sjemenki, pa niče više biljčica; prorijediti na 8–10 cm (mladi listovi mogu u salatu).',
  kombinacije: 'luk, salata, kupus, češnjak',
  pazi: 'blitva i špinat: ista porodica (lobode); plodored'
});
set('kukuruz', {
  sjetva: 'Izravno van kad se tlo dobro ugrije (sigurnije oko 15 °C, najranije 12 °C), obično svibanj, 4–5 cm duboko, 25–30 cm u redu, redovi 60–70 cm. Sijati u bloku (više kraćih redova) zbog oprašivanja vjetrom.',
  voda: 'Najvažnije u vrijeme svilanja i nalijevanja zrna.',
  problemi: 'Ptice i glodavci na zrelim klipovima; kukuruzni moljac može se pojaviti, ali u malom vrtu nije pravilo.',
  kombinacije: 'grah (penje se uz kukuruz), bundeva, tikvica, krastavac',
  pazi: 'visok je i zasjenjuje niže povrće: saditi na sjevernu stranu vrta'
});
set('persin', {
  kombinacije: 'rajčica, luk, poriluk',
  pazi: 'mrkva: ista porodica (štitarke) i ista mrkvina muha; plodored'
});
set('poriluk', {
  sjetva: 'Presadnice veljača–ožujak (ili rasadnik vani u travnju). Van svibanj–lipanj u rupe duboke oko 15 cm, bez zatrpavanja do vrha: zemlja se postupno dodaje ili se poriluk nagrće tijekom rasta, da donji dio ostane bijel.',
  opis: 'Otporan na hladnoću i obično može ostati u vrtu preko zime i brati se po potrebi, ali otpornost ovisi o sorti i jačini zime.',
  problemi: 'Miner poriluka (hodnici u listu, posebno u jesen), lukov moljac, hrđa u vlažnoj jeseni.',
  kombinacije: 'mrkva, celer, peršin',
  pazi: 'luk i češnjak: ista porodica i iste bolesti; plodored'
});

// Stari ključevi više se ne koriste
d.vrste.forEach(v => {
  if (!v.kombinacije || !v.pazi) throw new Error('Nedostaje kombinacije/pazi: ' + v.id);
  delete v.dobriSusjedi;
  delete v.losiSusjedi;
});

fs.writeFileSync(path, JSON.stringify(d, null, 2) + '\n');
console.log('ok: povrće revidirano (' + d.vrste.length + ' vrsta, ' + d.meta.savjeti.length + ' općih savjeta)');
