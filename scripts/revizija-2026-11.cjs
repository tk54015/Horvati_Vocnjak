// Jednokratna revizija sadržaja (studeni 2026.) prema stručnoj provjeri:
// prskanje samo kad je opravdano, fenofaze umjesto krutih datuma, kompost kao osnova,
// zalijevanje bez univerzalnih litara, razdvojena pravila rezidbe po tipu.
// ID-jevi zadataka i vrsta ostaju isti (spremljene kvačice i odgode vrijede i dalje).
// Pokretanje (iz mape projekta): node scripts/revizija-2026-11.cjs
const fs = require('fs');

// ---------------------------------------------------------------- RASPORED
const rasPath = 'data/raspored.json';
const ras = JSON.parse(fs.readFileSync(rasPath, 'utf8'));
ras.meta.napomena = 'Okvirni rokovi za hobi voćnjak u kontinentalnoj Hrvatskoj. Stvarna faza razvoja biljke (fenofaza) i vrijeme važniji su od mjeseca. Načelo: prvo pregledaj i mehanički ukloni zaražene dijelove, a prskaj samo kad je problem stvarno prisutan ili je rizik velik. Za sredstva uvijek provjeri etiketu, dopuštenu primjenu i karencu.';

const T = {
  'alat': { opis: 'Naoštriti škare i pilu, pripremiti prskalicu. Alat dezinficirati (alkohol) prije rezidbe i između rezova na bolesnim stablima.' },
  'mumije': { opis: 'Mumije na stablu i na tlu glavni su izvor monilije iduće godine. Skupiti ih čim ih primijetiš i odnijeti dalje od voćaka.' },
  'ribizl-rez': { opis: 'Crni ribizl: ostaviti oko 6–10 glavnih izboja i svake godine ukloniti otprilike trećinu najstarijih. Crveni i bijeli: održavati otvoren grm i uklanjati stare grane koje slabo rode. Rezati tijekom mirovanja, kad drvo nije smrznuto.' },
  'ribizl-grinja': { opis: 'Okrugli, nabrekli pupovi znače ribizovu grinju. U mirovanju ih otkinuti i uništiti; kod jakog napada ukloniti cijeli zaraženi izboj.' },
  'ulje-zima': { naslov: 'Zimski pregled kore i grana na štetnike', prioritet: 3, poPotrebi: true, opis: 'Pregledati koru i grane na štitaste uši, kruškinu buhu i nakupine jaja. Uljni pripravak samo ako ih stvarno ima i ako je dopušten za tu vrstu i fazu.' },
  'breskva-bakar-zima': { opis: 'Najvažnija zaštita breskve protiv kovrčavosti lista: prije otvaranja pupova (fenofaza je važnija od datuma). Kad se pupovi otvore i bolest se pojavi, kasno je. Jedno dobro tempirano prskanje obično je dovoljno.' },
  'loza-rez': { opis: 'Rezati u mirovanju, ali ne za jakog mraza. Ne čekati da loza jako zaplače. Broj pupova prilagoditi sorti i uzgojnom obliku.' },
  'jabuka-kruska-rez': { opis: 'Prorijediti krošnju, ukloniti suhe, bolesne i grane koje se križaju te vodopije. Najbolje završiti prije ili oko početka vegetacije, ovisno o vremenu u godini.' },
  'bakar-bubrenje': { naslov: 'Pregled i preventiva u bubrenju pupova', prioritet: 2, poPotrebi: true, vrste: ['jabuka', 'kruska', 'sljiva', 'tresnja', 'visnja'], opis: 'Ako je prošle godine bilo krastavosti (jabuka, kruška), rogača ili šupljikavosti (šljiva, trešnja, višnja) ili bakterijskog raka, ovo je dobar trenutak za preventivni bakreni tretman tih stabala. Ako problema nije bilo, dovoljan je pregled.' },
  'breskva-rez': { opis: 'Oko cvatnje, kad se razlikuju cvjetni pupovi. Ostaviti dobro razvijene jednogodišnje rodne izboje odgovarajuće debljine, ne sve nove izboje.' },
  'loza-bubrenje': { naslov: 'Pregled loze u bubrenju', prioritet: 3, poPotrebi: true, opis: 'Pregledati prošlogodišnje drvo na crnu pjegavost i ukloniti zaražene dijelove. Ako su prošle godine bile jake grinje (erinoza) ili crna pjegavost, ciljano zaštititi, i to posebno za svaki problem, prema etiketi.' },
  'sljiva-rez': { opis: 'U proljeće nakon jačih mrazeva ili ljeti nakon berbe. Rezati po suhom vremenu, pravilnim rezovima uz granu.' },
  'gnojidba-proljece': { opis: 'Ako imaš kompost: tanak sloj po projekciji krošnje (ne uz samo deblo), plitko unijeti ili ostaviti kao malč. Mineralno gnojivo nije potrebno ako stabla normalno rastu.' },
  'kupina-bocni': { opis: 'Bočne izboje na rodnim mladicama skratiti prema uzgojnom sustavu i sorti (orijentacijski 30–40 cm), mladice vezati na žicu.' },
  'mraz-cvatnja': { opis: 'Pratiti prognozu u cvatnji. Kritična temperatura ovisi o vrsti i fazi: otvoreni cvijet i mladi plodić osjetljiviji su od zatvorenog pupa. Manja i mlada stabla po potrebi prekriti agrotekstilom preko noći.' },
  'monilija-cvat': { prioritet: 2, poPotrebi: true, opis: 'Ako je u cvatnji kišno, preventivna zaštita ima smisla kod osjetljivih vrsta, posebno višnje. Po suhom vremenu nije potrebna. Suhe vrhove višnje izrezati po suhom vremenu 10–15 cm u zdravo.' },
  'krastavost': { opis: 'Najvažnije razdoblje za zdrave plodove: od mišjeg uha do nakon cvatnje. Pratiti kišu i fazu razvoja: zaraza nastaje kad je list dulje mokar. Štititi prije najavljene kiše, posebno ako je prošle godine bilo krastavosti.' },
  'sljiva-osice': { naslov: 'Pratiti šljivine osice', mjeseci: [3, 4], prioritet: 2, poPotrebi: true, opis: 'Bijele ljepljive ploče objesiti prije cvatnje radi praćenja leta. Tretman samo ako je ulov velik, i to odmah nakon otpadanja latica, jer se ličinke brzo ubuše u plodiće.' },
  'palez-pregled': { opis: 'Pocrnjeli cvjetovi i vrhovi savijeni kao štap. Zaražene grane izrezati po suhom vremenu, dovoljno duboko u zdravo (30–50 cm) i dezinficirati alat nakon svakog reza.' },
  'orah-bakar': { naslov: 'Pregled oraha na bakterijsku palež', prioritet: 3, poPotrebi: true, opis: 'Ako je prošlih godina bilo crnih pjega i otpadanja mladih plodova, u kišnom listanju i cvatnji ima smisla bakreni tretman. Inače samo pregled.' },
  'ribizl-pepelnica': { naslov: 'Pregled ribizla na pepelnicu', prioritet: 3, poPotrebi: true, opis: 'Pregledati vrhove izboja. Zaražene vrhove odrezati i grm prozračiti. Zaštita samo ako se pepelnica pojavi i širi.' },
  'feromonske-klopke': { opis: 'Klopke služe za praćenje leta savijača. Postaviti prije očekivanog leta; ulov pokazuje kad pojačati pregled plodova, a ne znači automatski prskanje.' },
  'malc': { opis: 'Malč (slama, pokošena trava, kora) čuva vlagu ljeti. Sloj ne predebeo (5–8 cm) i ne naslanjati ga na deblo.' },
  'loza-zelena': { opis: 'Plijevljenje suvišnih mladica, uklanjanje zaperaka, vezanje. Ne uklanjati previše lišća, jer grozdovi mogu dobiti sunčane ožegotine.' },
  'loza-zastita': { prioritet: 2, poPotrebi: true, opis: 'U kišnim razdobljima ovo je najvažniji posao u vinogradu. Razmak između tretmana uskladiti s kišom, novim porastom i uputom pripravka, a ne s fiksnim kalendarom. Pravilo 3 × 10 je samo orijentacija za početak rizika od peronospore.' },
  'tresnja-ploce': { opis: 'Žute ljepljive ploče postaviti prije očekivanog leta muhe (obično svibanj) radi praćenja. Muha najviše napada srednje kasne i kasne sorte.' },
  'tresnja-mreze': { opis: 'Prekriti trešnje prije dozrijevanja, prije nego ptice počnu napadati plodove.' },
  'glog-cvijet': { mjeseci: [4, 5], opis: 'Na početku stvarne cvatnje (u toplijim godinama već krajem travnja), po suhom vremenu; sušiti u hladu.' },
  'berba-tresnja': { opis: 'Ovisno o sorti. Brati s peteljkom i redovito, da octena mušica nema hrane.' },
  'zalijevanje': { opis: 'Prioritet: mlada stabla (prve 2–3 godine) i breskve. Prije zalijevanja provjeriti vlagu tla na 10–20 cm dubine. Na glinastom tlu voda se dugo zadržava, pa zalijevati rjeđe i ne prelijevati; previše vode može biti veći problem od suše. Odrasla stabla dubokog korijena zalijevati samo u dužoj suši.' },
  'prorjedivanje': { opis: 'Nakon lipanjskog opadanja. Jabuka: najčešće jedan plod po cvjetnom grozdu. Breskva: razmak prilagoditi sorti i bujnosti (orijentacijski 15–20 cm). Plodovi budu veći, a stablo se ne iscrpi.' },
  'berba-visnja': { opis: 'Kad plodovi postignu boju i okus karakterističan za sortu, ovisno o namjeni (svježe, sok, liker).' },
  'tresnja-visnja-rez': { opis: 'Ljetni rezovi brže zacjeljuju. Smanjiti visinu i prorijediti krošnju, umjereno, bez agresivnog rezanja.' },
  'orahova-muha': { mjeseci: [6, 7], opis: 'Žute ploče postaviti prije očekivanog leta (let varira po godini, obično od kraja lipnja). Zaražene zelene ljuske i plodove skupljati i uklanjati.' },
  'berba-breskva': { opis: 'Zrelost procijeniti po osnovnoj boji kožice (iz zelene u žutu ili kremastu), mekoći i okusu karakterističnom za sortu.' },
  'kupina-rez': { opis: 'Za standardne sorte: izboje koji su rodili odrezati do tla odmah nakon berbe, a od novih ostaviti onoliko najjačih koliko odgovara razmaku i žici (orijentacijski 5–8). Remontantne sorte, koje rode na jednogodišnjim izbojima, režu se drukčije, obično sve do tla krajem zime.' },
  'loza-sara': { opis: 'Prozračiti zone grozdova prema sorti i položaju. Na suncem izloženoj strani ostaviti dovoljno lišća zbog ožegotina. Po potrebi zaštita od sive plijesni.' },
  'berba-drenak': { opis: 'Plodovi dozrijevaju postupno: brati kad potamne i omekšaju ili tresti na plahtu one koji sami otpadaju.' },
  'berba-kruska': { opis: 'Ovisno o sorti: plod se lako odvaja kad se podigne, a meso još je čvrsto. Zimske sorte brati prije pune jestive zrelosti, dozrijevaju u skladištu.' },
  'berba-jabuka': { opis: 'Zrelost procijeniti po sorti: plod se lako odvaja podizanjem i okretanjem, mijenja se osnovna boja, a sjemenke su smeđe. Jedan pokazatelj nije dovoljan.' },
  'berba-orah': { opis: 'Kad zelena ljuska pukne i orasi počnu padati. Skupljati redovito i odmah sušiti na prozračnom mjestu.' },
  'berba-glog': { opis: 'Brati potpuno obojene plodove, najčešće rujan–listopad.' },
  'gnojidba-jesen': { opis: 'Ako imaš kompost ili zreli stajski gnoj: rasporediti po projekciji krošnje. Ne treba svake godine gnojiti sve biljke.' },
  'lisce': { opis: 'Ukloniti lišće ispod stabala koja su imala krastavost, kozičavost ili antraknozu (jabuka, kruška, trešnja, višnja, orah). Zdravo lišće može ostati ili ići na kompost.' },
  'bakar-jesen': { naslov: 'Jesenski bakar (po potrebi)', prioritet: 3, poPotrebi: true, opis: 'Nije obavezan. Ima smisla na stablima koja su imala bakterijski rak ili jaku šupljikavost (šljiva, trešnja, višnja). Za breskvu zamjenjuje ili nadopunjuje prskanje prije otvaranja pupova; ako planiraš prskati u kasnu zimu, ovo možeš preskočiti.' },
  'sadnja': { opis: 'Jesen je najbolje vrijeme za sadnju golih sadnica. Ne saditi u smrznuto ili natopljeno glinasto tlo. Dodaj ih odmah na kartu (Dodaj stablo).' },
  'smokva-zastita': { opis: 'Malč oko baze, mlade biljke omotati agrotekstilom. Čuvati vrhove prošlogodišnjih izboja na kojima su sitni zametnuti plodići.' },
  'premaz-debla': { opis: 'Vapneni premaz štiti koru od pucanja i ožegotina zbog razlike dnevne i noćne temperature krajem zime. Najkorisniji kod mladih stabala i na izloženoj južnoj strani; nije obavezan.' }
};

const missing = [];
Object.entries(T).forEach(([id, patch]) => {
  const t = ras.zadaci.find(z => z.id === id);
  if (!t) { missing.push(id); return; }
  Object.assign(t, patch);
});
if (missing.length) throw new Error('Nepoznati zadaci: ' + missing.join(', '));

let rasOut = JSON.stringify(ras, null, 2);
rasOut = rasOut.replace(/\{\n\s+"id": [\s\S]*?\n\s+\}(?=,?\n)/g, m => m.includes('"mjeseci"')
  ? m.replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']')
  : m);
fs.writeFileSync(rasPath, rasOut + '\n');

// ------------------------------------------------------------- ENCIKLOPEDIJA
const encPath = 'data/enciklopedija.json';
const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
enc.meta.napomena = 'Opće preporuke za hobi voćnjak u kontinentalnoj Hrvatskoj. Rokovi ovise o sorti, starosti stabla, tlu i vremenu u godini; faza razvoja biljke važnija je od datuma. Načelo zaštite: prvo pregled i mehaničko uklanjanje zaraženih dijelova, a prskanje samo kad je problem prisutan ili je rizik velik. Za sredstva uvijek provjeri etiketu, dopuštenu primjenu i karencu.';

const V = (id) => {
  const v = enc.vrste.find(x => x.id === id);
  if (!v) throw new Error('Nepoznata vrsta: ' + id);
  return v;
};
const bolest = (v, naziv, patch) => {
  const b = v.bolesti.find(x => x.naziv.startsWith(naziv));
  if (!b) throw new Error(v.id + ': nema bolesti ' + naziv);
  Object.assign(b, patch);
};
const stetnik = (v, naziv, patch) => {
  const b = v.stetnici.find(x => x.naziv.startsWith(naziv));
  if (!b) throw new Error(v.id + ': nema štetnika ' + naziv);
  Object.assign(b, patch);
};
const KOMPOST = 'Osnova je kompost ili zreli stajski gnoj po projekciji krošnje, u jesen ili rano proljeće. Mineralno gnojivo samo ako stablo slabo raste ili pokazuje nedostatak hraniva, ne automatski svake godine.';
const GLINA = ' Na glinastom tlu voda se dugo zadržava: prije zalijevanja provjeriti vlagu na 10–20 cm i ne prelijevati.';

// Jabuka
let v = V('jabuka');
v.voda = 'Srednja potreba. Mlada stabla redovito zalijevati u sušnim razdobljima; odrasla stabla dubokog korijena samo u dužoj suši, osobito u lipnju i srpnju kad plodovi rastu. Količina ovisi o veličini stabla, tlu i oborinama. Malč čuva vlagu.' + GLINA;
v.orezivanje.kada = 'Zimska rezidba od kraja veljače, prije ili oko početka vegetacije (ovisno o godini). Ljetna (zelena) rezidba u lipnju i srpnju.';
v.orezivanje.kako = 'Prorjeđivati krošnju da uđe svjetlo, ukloniti suhe, bolesne i grane koje se križaju te vodopije. Rodne grančice ne skraćivati previše. Vrhove izboja s pepelnicom izrezati zimi i u proljeće čim se pojave. Nakon lipanjskog opadanja prorijediti plodove, najčešće na jedan po cvjetnom grozdu.';
v.gnojidba = KOMPOST;
bolest(v, 'Krastavost', { naziv: 'Krastavost jabuke', opis: 'Maslinaste do tamne baršunaste pjege na listu i plodu; jako zaraženi plodovi mogu se deformirati i pucati. Najvažnija bolest jabuke, širi se u proljeće kad je list dulje mokar od kiše.' });
bolest(v, 'Pepelnica', { opis: 'Bijela prevlaka na mladim listovima i izbojcima. Zaražene vrhove izboja izrezati zimi i u proljeće čim se pojave; to je glavna mjera.' });
v.bolesti.push({ naziv: 'Rak kore', opis: 'Udubljene, napukle rane na granama i deblu, često oko pupova i rana od rezidbe. Zaražene grane izrezati u zdravo po suhom vremenu.' });
v.stetnici.push({ naziv: 'Potkornjaci', opis: 'Sitne rupice na kori, uglavnom na oslabljenim stablima. Najbolja zaštita je dobra kondicija stabla i uklanjanje suhih grana.' });
v.zastita = [
  { kada: 'Mirovanje', sto: 'Ukloniti mumije, rak-rane i vrhove s pepelnicom; pregledati koru na štetnike.' },
  { kada: 'Bubrenje pupova', sto: 'Preventivni bakreni tretman ako je prošle godine bilo krastavosti; inače samo pregled.' },
  { kada: 'Mišje uho do nakon cvatnje', sto: 'Glavno razdoblje zaštite od krastavosti: štititi prije najavljene kiše, posebno kod osjetljivih sorti.' },
  { kada: 'Ljeto', sto: 'Pratiti savijača feromonskim klopkama i pregledom plodova; crvljive plodove skupljati.' },
  { kada: 'Jesen, opadanje lišća', sto: 'Pograbiti lišće ispod stabala s krastavošću i ukloniti mumije.' }
];
v.berba = 'Ljetne sorte srpanj–kolovoz, jesenske i zimske rujan–listopad. Zrelost procijeniti po sorti: plod se lako odvaja podizanjem i okretanjem, mijenja se osnovna boja, a sjemenke su smeđe. Jedan pokazatelj nije dovoljan.';

// Kruška
v = V('kruska');
v.opis = 'Dugovječna voćka. Neke sorte cvatu nešto ranije od jabuke, pa su osjetljivije na proljetni mraz. Većini sorti treba oprašivač.';
v.voda = 'Srednja potreba, nešto veća u vrijeme rasta plodova. Mlada stabla zalijevati u suši.' + GLINA;
v.orezivanje.kada = 'Kraj zime, veljača–ožujak, prije ili oko početka vegetacije. Ljetna rezidba vodopija u lipnju i srpnju.';
v.gnojidba = KOMPOST;
bolest(v, 'Hrđa', { opis: 'Narančaste pjege na listu, a s donje strane izrasline. Prijelazni domaćin je kleka / sabina; uklanjanje kleke u blizini smanjuje zarazu, ali spore mogu doći i s veće udaljenosti.' });
stetnik(v, 'Kruškina buha', { opis: 'Ljepljiva medna rosa i čađavica na lišću i plodovima. Pratiti brojnost u proljeće; zimski uljni pripravak samo kod jačeg napada, ne svake godine.' });
v.zastita = [
  { kada: 'Mirovanje', sto: 'Pregledati grane na kruškinu buhu i rak-rane; uljni pripravak samo ako je napad bio jak.' },
  { kada: 'Bubrenje pupova', sto: 'Preventivni bakreni tretman ako je prošle godine bilo krastavosti; inače pregled.' },
  { kada: 'Prije i poslije cvatnje', sto: 'Zaštita od krastavosti u kišnom vremenu; u cvatnji pregledavati ima li znakova paleži.' },
  { kada: 'Ljeto', sto: 'Uklanjati vodopije i izboje s paleži (po suhom vremenu).' }
];
v.berba = 'Kolovoz–listopad, ovisno o sorti. Plod je spreman kad se lako odvaja podizanjem, a meso je još čvrsto. Zimske sorte brati prije pune jestive zrelosti; dozrijevaju u skladištu.';

// Šljiva
v = V('sljiva');
v.voda = 'Srednja potreba. Zalijevati u suši tijekom rasta plodova (lipanj–kolovoz), posebno mlada stabla. Ne podnosi dugotrajno zadržavanje vode u tlu.' + GLINA;
v.orezivanje.kada = 'U proljeće nakon jačih mrazeva (kad krene vegetacija) ili ljeti nakon berbe. Izbjegavati veće rezove u jesen i zimi.';
v.orezivanje.kako = 'Prorjeđivati gustu krošnju i uklanjati suhe grane. Rezati po suhom vremenu, pravilnim rezovima uz granu (bez patrljaka); to je najbolja zaštita od srebrnaste bolesti i smolotoka.';
v.gnojidba = KOMPOST;
bolest(v, 'Šarka', { opis: 'Svijetli prstenovi i pjege na listu, deformirani, kiseli plodovi koji prerano opadaju. Nije svako stablo s deformiranim plodovima zaraženo: sumnju potvrditi (savjetodavna služba ili laboratorij). Potvrđeno zaražena stabla su neizlječiva i treba ih izvaditi. Virus šire lisne uši.' });
stetnik(v, 'Šljivin savijač', { opis: 'Crvljivi plodovi koji ranije dozrijevaju i opadaju. Pratiti feromonskim klopkama od svibnja.' });
stetnik(v, 'Šljivine osice', { opis: 'Ličinke u mladim plodićima nakon cvatnje; plodići otpadaju. Pratiti bijelim ljepljivim pločama postavljenim prije cvatnje.' });
v.zastita = [
  { kada: 'Mirovanje', sto: 'Ukloniti mumije i suhe grane; pregledati ima li rak-rana.' },
  { kada: 'Bubrenje pupova', sto: 'Bakreni tretman ako je prošle godine bilo rogača ili šupljikavosti; inače pregled.' },
  { kada: 'Prije cvatnje', sto: 'Objesiti bijele ljepljive ploče za praćenje šljivinih osica.' },
  { kada: 'Odmah nakon cvatnje', sto: 'Tretman protiv osica samo ako je ulov na pločama velik.' },
  { kada: 'Svibanj–kolovoz', sto: 'Pratiti savijača feromonskim klopkama i pregledom plodova.' }
];

// Smokva
v = V('smokva');
v.opis = 'Mediteranska voćka koja u kontinentu uspijeva na toplom, zaštićenom mjestu (uz južni zid). Otpornost na mraz ovisi o sorti, starosti, položaju i trajanju hladnoće; jak mraz može oštetiti izbojke ili cijeli nadzemni dio, ali se biljka obično obnovi iz korijena.';
v.voda = 'Niska potreba, podnosi sušu. Za lijepe plodove ljeti povremeno temeljito zaliti. Ne prelijevati, jer plodovi pucaju i trunu.' + GLINA;
v.orezivanje.kada = 'Proljeće (obično travanj), tek kad prođe opasnost od jačih mrazeva i vidi se što je smrznuto.';
v.orezivanje.kako = 'Minimalno: ukloniti smrznute, suhe i preguste grane. Čuvati vrhove prošlogodišnjih izboja sa sitnim zametnutim plodićima (mogu dati prvu berbu). Prejaka rezidba potiče bujan rast bez ploda. Mladim biljkama zimi zaštititi bazu malčem.';
stetnik(v, 'Štitaste uši', { opis: 'Voštani štitići na granama i medna rosa. Manje kolonije ostrugati; uljni pripravak zimi samo kod jačeg napada i ako je dopušten.' });
v.zastita = [
  { kada: 'Zima', sto: 'Zaštita mladih biljaka od mraza; pregled na štitaste uši, uljni pripravak samo ako ih ima puno.' }
];

// Breskva
v = V('breskva');
v.voda = 'Visoka potreba, osobito u zadnjih 4–6 tjedana prije berbe, kad plod najviše raste. U suši redovito zalijevati.' + GLINA;
v.orezivanje.kada = 'Oko cvatnje (obično ožujak), kad se razlikuju cvjetni pupovi; faza razvoja važnija je od datuma. Ljetna rezidba nakon berbe.';
v.orezivanje.kako = 'Oblik otvorene vaze. Svake godine obnavljati rodno drvo: dio izbojaka koji su rodili ukloniti, a ostaviti dobro razvijene jednogodišnje izboje odgovarajuće debljine (ne sve nove). Plodove prorijediti prema sorti i bujnosti (orijentacijski 15–20 cm).';
v.gnojidba = KOMPOST + ' Breskva je od voćaka najzahtjevnija, pa joj kompost dati prvoj.';
bolest(v, 'Kovrčavost', { opis: 'Listovi se u proljeće naboraju, zadebljaju i pocrvene, pa otpadnu. Kad se pojavi, kasno je za zaštitu. Ključno je jedno dobro tempirano bakreno prskanje prije otvaranja pupova (kasna zima); jesensko prskanje pri opadanju lišća je dopuna, ne obveza.' });
v.zastita = [
  { kada: 'Kasna zima, prije otvaranja pupova', sto: 'Bakreni pripravak protiv kovrčavosti: najvažniji tretman breskve.' },
  { kada: 'Opadanje lišća (jesen)', sto: 'Po želji dodatni bakreni tretman, posebno ako je kovrčavost bila jaka.' },
  { kada: 'Cvatnja', sto: 'Zaštita od monilije samo u kišnom vremenu.' },
  { kada: 'Ljeto', sto: 'Pratiti savijača i pepelnicu; zaražene plodove i vrhove ukloniti.' }
];
v.berba = 'Srpanj–rujan, ovisno o sorti. Zrelost procijeniti po osnovnoj boji kožice (iz zelene u žutu ili kremastu), mekoći i okusu.';

// Trešnja
v = V('tresnja');
v.opis = 'Bujna, visoka voćka, prva u sezoni berbe. Većini sorti treba oprašivač. Plodovi pucaju prvenstveno zbog kiše u vrijeme dozrijevanja.';
v.voda = 'Srednja potreba. Ne podnosi mokro i teško tlo; mlada stabla zalijevati u suši.' + GLINA;
v.gnojidba = KOMPOST + ' Previše dušika pojačava bujnost.';
stetnik(v, 'Trešnjina muha', { opis: 'Crvljivi plodovi, uglavnom kod srednje kasnih i kasnih sorti; rane sorte često izbjegnu napad. Žute ljepljive ploče služe za praćenje leta, postaviti ih prije očekivanog leta.' });
stetnik(v, 'Ptice', { opis: 'Zaštitne mreže postaviti prije dozrijevanja, prije nego ptice počnu napadati plodove.' });
v.zastita = [
  { kada: 'Opadanje lišća', sto: 'Bakreni pripravak samo ako je bilo bakterijskog raka ili jake šupljikavosti.' },
  { kada: 'Cvatnja', sto: 'Zaštita od monilije samo u kišnom vremenu.' },
  { kada: 'Svibanj', sto: 'Žute ploče za praćenje trešnjine muhe; mreže protiv ptica.' },
  { kada: 'Jesen', sto: 'Pograbiti lišće ako je bilo kozičavosti.' }
];
v.berba = 'Svibanj–lipanj (kasne sorte do srpnja), ovisno o sorti. Brati s peteljkom.';

// Višnja
v = V('visnja');
v.orezivanje.kako = 'Ovisno o sorti, rodi na jednogodišnjem drvu i na kratkim rodnim grančicama. Bez rezidbe grane ogole i rod se seli na vrhove. Prorjeđivati i pomlađivati postupno, čuvajući produktivne rodne grančice.';
v.gnojidba = KOMPOST;
bolest(v, 'Monilijska palež', { opis: 'Kod višnje vrlo jaka: cvjetovi i vrhovi grančica naglo se osuše. Suhe vrhove izrezati po suhom vremenu 10–15 cm u zdravo.' });
v.zastita = [
  { kada: 'Bubrenje pupova', sto: 'Bakreni tretman ako je prošle godine bilo jake monilije ili kozičavosti; inače pregled.' },
  { kada: 'Početak i puna cvatnja', sto: 'Zaštita od monilije ako je kišno; po suhom vremenu nije potrebna.' },
  { kada: 'Odmah po pojavi', sto: 'Izrezati osušene vrhove (po suhom vremenu).' }
];
v.berba = 'Lipanj–srpanj, kad plodovi postignu boju i okus karakterističan za sortu, ovisno o namjeni.';

// Glog
v = V('glog');
bolest(v, 'Bakterijska palež', { opis: 'Glog može biti domaćin bakterijske paleži. Ne treba ga preventivno tretirati, ali u proljeće pregledati i osušene vrhove izrezati, posebno ako su blizu jabuka i krušaka.' });
v.berba = 'Cvijet na početku cvatnje (travanj–svibanj, ovisno o godini), plodovi kad se potpuno oboje, najčešće rujan–listopad.';

// Drenak
v = V('drenak');
v.orezivanje.kada = 'Nakon cvatnje; budući da cvate vrlo rano, to može biti već u ožujku.';
v.berba = 'Kolovoz–rujan. Plodovi dozrijevaju postupno: brati kad potamne i omekšaju, ili tresti na plahtu one koji sami otpadaju.';

// Kupina
v = V('kupina');
v.opis = 'Grm koji kod većine sorti ima dvogodišnje izboje: izboj u prvoj godini raste, u drugoj rodi pa se osuši. Postoje i remontantne sorte koje rode već na jednogodišnjim izbojima. Za uzgoj su najbolje sorte bez trnja.';
v.voda = 'Srednja do visoka u vrijeme dozrijevanja plodova. Plitko korijenje, pa pomaže malčiranje.' + GLINA;
v.orezivanje.kako = 'Standardne sorte: izboje koji su rodili odrezati do tla nakon berbe; od novih ostaviti onoliko najjačih koliko odgovara razmaku i žici (orijentacijski 5–8) i vezati ih. U proljeće skratiti bočne izboje prema uzgoju (orijentacijski 30–40 cm). Remontantne sorte obično se krajem zime režu sve do tla.';
v.gnojidba = 'Kompost ili zreli stajski gnoj u proljeće.';
v.zastita = [
  { kada: 'Mirovanje i proljeće', sto: 'Ukloniti izboje s pjegama i suhe izboje; bakreni tretman samo ako je pjegavost izboja bila jaka.' },
  { kada: 'Dozrijevanje', sto: 'Brati često i ne ostavljati prezrele plodove (octena mušica, siva plijesan).' }
];

// Ribizl
v = V('ribizl');
v.opis = 'Grm koji dobro podnosi hladnoću i polusjenu. Crni ribizl rodi uglavnom na mladim (jednogodišnjim) izbojima, a crveni i bijeli na kratkim rodnim grančicama na starijem drvu, pa se različito orezuju.';
v.voda = 'Srednja do visoka. Plitko korijenje: malčirati i zalijevati u suši, osobito u vrijeme dozrijevanja.' + GLINA;
v.orezivanje.kada = 'Tijekom mirovanja (studeni–ožujak), prije početka vegetacije, na dan kad drvo nije smrznuto.';
v.orezivanje.kako = 'Crni ribizl: ostaviti oko 6–10 glavnih izboja i svake godine ukloniti otprilike trećinu najstarijih, kako bi stalno rasli novi rodni izboji. Crveni i bijeli: održavati otvoren grm s granama različite starosti; ukloniti stare grane koje slabo rode, ne automatski svaku stariju od određene dobi.';
v.gnojidba = 'Kompost u proljeće; voli kalij (npr. pepeo od drva u malim količinama).';
bolest(v, 'Pepelnica', { opis: 'Bijela pa smeđa prevlaka na vrhovima izboja i bobicama. Zaražene vrhove odrezati i grm prozračiti; zaštita samo ako se širi.' });
stetnik(v, 'Ribizova grinja', { opis: 'Pupovi nabreknu i postanu okrugli. U mirovanju ih otkinuti i uništiti; kod jakog napada ukloniti cijeli zaraženi izboj.' });
v.zastita = [
  { kada: 'Mirovanje', sto: 'Otkinuti nabrekle pupove (grinja), izrezati izboje sa staklokrilcem.' },
  { kada: 'Prije i poslije cvatnje', sto: 'Pregledati vrhove na pepelnicu; zaražene odrezati, zaštita samo ako se širi.' },
  { kada: 'Jesen', sto: 'Pograbiti lišće ako je bilo pjegavosti.' }
];

// Dud
v = V('dud2');
v.orezivanje.kako = 'Minimalno: ukloniti suhe grane i one koje smetaju. Kod starijih stabala izbjegavati velike rezove, jer sporo zacjeljuju.';

// Vinova loza
v = V('vinova_loza');
v.voda = 'Niska do srednja potreba; podnosi sušu. Previše vode slabi kvalitetu i pogoduje bolestima. Mlade trsove zalijevati u suši.' + GLINA;
v.orezivanje.kada = 'Zimska rezidba u mirovanju, veljača–ožujak, ali ne za jakog mraza i ne čekati da loza jako zaplače. Zelena rezidba svibanj–srpanj.';
v.orezivanje.kako = 'Broj pupova prilagoditi sorti i uzgojnom obliku (kordonac, Guyot). Ukloniti prošlogodišnje drvo s crnom pjegavošću. Zelena rezidba: plijevljenje suvišnih mladica, zaperci, umjereno prorjeđivanje lišća oko grozdova (ne previše zbog ožegotina).';
v.gnojidba = 'Umjereno. Kompost ili stajski gnoj u jesen; loza ne traži puno hrane.';
bolest(v, 'Peronospora', { opis: 'Uljne pjege na licu lista i bijela prevlaka na naličju; grozdovi se suše. Pravilo 3 × 10 (iznad 10 °C, mladice dulje od 10 cm, barem 10 mm kiše) samo je orijentacija za početak rizika, ne potpuna prognoza.' });
bolest(v, 'Crna pjegavost', { opis: 'Crne pjege i pukotine na osnovi mladica. Glavna mjera je uklanjanje zaraženog prošlogodišnjeg drva pri rezidbi.' });
v.bolesti.push({ naziv: 'Crna trulež', opis: 'Smeđe pjege s tamnim rubom na listu, a bobice se smežuraju u tvrde crne mumije. Mumije ukloniti s trsa i tla.' });
v.zastita = [
  { kada: 'Rezidba', sto: 'Ukloniti drvo s crnom pjegavošću i mumije grozdova.' },
  { kada: 'Bubrenje pupova', sto: 'Ciljana zaštita samo ako su prošle godine bile jake grinje (erinoza) ili crna pjegavost.' },
  { kada: 'Od 3–5 listova do zatvaranja grozda', sto: 'Zaštita od peronospore i pepelnice prema kiši, novom porastu i uputi pripravka, ne po fiksnom kalendaru.' },
  { kada: 'Šara (omekšavanje bobica)', sto: 'Prozračiti grozdove prema sorti; zaštita od sive plijesni po potrebi.' }
];

// Orah
v = V('orah');
v.orezivanje.kada = 'Ljeti (srpanj–kolovoz). Ne u kasnu zimu i proljeće, jer orah jako curi sok.';
stetnik(v, 'Orahova muha', { opis: 'Zelena ljuska pocrni i postane ljepljiva, a jezgra je tamna. Žute ljepljive ploče postaviti prije očekivanog leta (varira po godini, obično od kraja lipnja); zaražene ljuske i plodove skupljati i uklanjati.' });
v.zastita = [
  { kada: 'Listanje i cvatnja', sto: 'Bakreni tretman samo ako je prethodnih godina bilo bakterijske paleži, i to u kišnom vremenu.' },
  { kada: 'Kraj lipnja', sto: 'Žute ploče za praćenje orahove muhe.' },
  { kada: 'Jesen', sto: 'Ukloniti otpalo lišće (antraknoza) i zaražene plodove.' }
];
v.berba = 'Rujan–listopad, kad zelena ljuska pukne i orasi počnu padati. Skupljati redovito i odmah sušiti na prozračnom mjestu.';

// Ostalo
v = V('ostalo');
v.orezivanje.kada = 'Ovisi o biljci. Većinu listopadnih stabala i grmova koji cvatu ljeti orezati u mirovanju (kasna zima). Grmove koji cvatu u proljeće na prošlogodišnjim izbojima orezati odmah nakon cvatnje.';
v.voda = 'Ovisi o biljci. Novoposađena stabla i grmove prve 1–2 godine redovito zalijevati u suši.' + GLINA;

fs.writeFileSync(encPath, JSON.stringify(enc, null, 2) + '\n');
console.log('ok: raspored', Object.keys(T).length, 'zadataka izmijenjeno; enciklopedija revidirana');
