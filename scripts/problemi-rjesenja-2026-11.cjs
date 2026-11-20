// Jednokratno: bolesti i štetnici u enciklopediji kao "kako prepoznati" -> "što napraviti",
// i nova vrsta borovnica. Pokretanje (iz mape projekta): node scripts/problemi-rjesenja-2026-11.cjs
const fs = require('fs');
const path = 'data/enciklopedija.json';
const enc = JSON.parse(fs.readFileSync(path, 'utf8'));

// [naziv, kako prepoznati, što napraviti]
const P = {
  jabuka: {
    bolesti: [
      ['Krastavost jabuke', 'Maslinaste do tamne baršunaste pjege na listu i plodu; jako zaraženi plodovi mogu se deformirati i pucati. Najvažnija bolest jabuke, širi se u proljeće kad je list dulje mokar od kiše.',
        'U jesen pograbiti i ukloniti lišće (na njemu prezimljuje). Krošnju prozračiti rezidbom. Ako je bilo krastavosti, od mišjeg uha do nakon cvatnje štititi prije najavljene kiše (bakreni pa organski/sumporni pripravci prema etiketi).'],
      ['Pepelnica jabuke', 'Bijela, brašnasta prevlaka na mladim listovima i vrhovima izboja; listovi se suše i uvijaju.',
        'Zaražene vrhove izboja izrezati zimi i u proljeće čim se pojave – to je glavna mjera. Kod jakog napada sumporni pripravci od početka cvatnje.'],
      ['Monilija (trulež plodova)', 'Smeđa trulež ploda s koncentričnim krugovima bjelkastih jastučića; plodovi se osuše u tvrde „mumije”.',
        'Mumije skupiti sa stabla i s tla i odnijeti iz voćnjaka. Trule plodove brati čim se pojave. Izbjegavati ozljede plodova (ose, tuča, savijač).'],
      ['Bakterijska palež', 'Cvjetovi i vrhovi izboja naglo venu i pocrne, savijaju se kao pastirski štap; iz rana može curiti ljepljiv iscjedak.',
        'Zaražene grane po suhom vremenu izrezati 30–50 cm u zdravo i spaliti ili odnijeti. Alat dezinficirati nakon svakog reza. Ne gnojiti previše dušikom. Sumnju prijaviti savjetodavnoj službi.'],
      ['Rak kore', 'Udubljene, napukle rane na granama i deblu, često oko pupova i rana od rezidbe; kora oko rane odumire.',
        'Zaražene grane izrezati u zdravo po suhom vremenu; rane na deblu očistiti do zdravog drva. Rezati pravilno, bez patrljaka. Kod jakog napada bakar u jesen pri opadanju lišća.']
    ],
    stetnici: [
      ['Jabučni savijač', 'Crv (ličinka) u plodu, rupica s izmetom na plodu; crvljivi plodovi ranije opadaju.',
        'Feromonske klopke od svibnja za praćenje leta. Crvljive i otpale plodove redovito skupljati. Kod jakog napada ciljani tretman u vrijeme izlaska ličinki, prema ulovu.'],
      ['Lisne uši (zelena, krvava uš)', 'Kovrčanje lista i ljepljiva medna rosa; krvava uš stvara bijele vunaste kolonije na kori i ranama.',
        'Male kolonije isprati mlazom vode ili otkinuti vrhove. Poticati korisne kukce (bubamare, zlatooke). Prskati samo kod jakog napada mladih stabala.'],
      ['Crveni voćni pauk (grinja)', 'List posvijetli, postane sitno točkast pa brončan, ljeti u suhom i vrućem vremenu.',
        'Pregledati naličje lista lupom. Izbjegavati širokospektralna sredstva koja ubijaju grabežljive grinje. Kod jakog napada zimsko uljno prskanje iduće godine.'],
      ['Potkornjaci', 'Sitne rupice na kori i piljevina, uglavnom na oslabljenim i suhim granama.',
        'Održavati stablo u dobroj kondiciji (voda, kompost). Suhe i napadnute grane izrezati i spaliti prije proljeća.']
    ]
  },
  kruska: {
    bolesti: [
      ['Krastavost kruške', 'Tamne pjege na listu i plodu, plodovi pucaju i ostaju sitni.',
        'Kao kod jabuke: ukloniti otpalo lišće, prozračiti krošnju, a ako je bilo zaraze štititi prije kiše od pupanja do nakon cvatnje.'],
      ['Bakterijska palež', 'Kruška je vrlo osjetljiva: pocrnjeli cvjetovi i vrhovi izboja savijeni kao pastirski štap.',
        'Zaražene grane po suhom vremenu izrezati duboko u zdravo (30–50 cm) i spaliti, alat dezinficirati. Pregledavati u cvatnji. Sumnju prijaviti savjetodavnoj službi.'],
      ['Hrđa kruške', 'Narančaste pjege na licu lista, a na naličju izrasline poput bradavica.',
        'Ukloniti zaraženo lišće. Ne saditi kleku / sabinu u blizini (prijelazni domaćin); spore ipak mogu doći i izdaleka. Kod jakog napada zaštita u proljeće.']
    ],
    stetnici: [
      ['Kruškina buha', 'Ljepljiva medna rosa i crna čađavica na lišću i plodovima; mlade ličinke u pazušcima listova.',
        'Pratiti brojnost u proljeće. Zimski uljni pripravak samo nakon jačeg napada, ne svake godine. Ne gnojiti previše dušikom.'],
      ['Lisne uši i savijač', 'Kovrčanje lista (uši) i crvljivi plodovi (savijač).',
        'Kao kod jabuke: uši isprati ili otkinuti vrhove, za savijača feromonske klopke i skupljanje crvljivih plodova.']
    ]
  },
  sljiva: {
    bolesti: [
      ['Šarka šljive (virus)', 'Svijetli prstenovi i pjege na listu, deformirani, kiseli plodovi koji prerano opadaju.',
        'Sumnju potvrditi (savjetodavna služba ili laboratorij) – nije svako stablo s deformiranim plodovima zaraženo. Potvrđeno zaražena stabla su neizlječiva: izvaditi ih. Saditi certificirane sadnice; virus šire lisne uši.'],
      ['Rogač šljive', 'Plodovi izduženi, spljošteni i šuplji, bez koštice; kasnije se presvuku sivom prevlakom.',
        'Zaražene plodove otkinuti i ukloniti prije nego se presvuku. Ako ga je bilo, bakreni tretman u vrijeme bubrenja pupova iduće godine.'],
      ['Monilija', 'Sušenje cvjetova u kišnoj cvatnji i trulež zrelih plodova s jastučićima.',
        'Ukloniti mumije i suhe grančice. Ne ostavljati trule plodove. U kišnoj cvatnji zaštita cvijeta ako je prijašnjih godina bilo jake zaraze.'],
      ['Šupljikavost lista', 'Male crvenkaste pjege koje ispadnu, pa list izgleda kao izbušen sačmom.',
        'Pograbiti otpalo lišće. Kod jače zaraze bakar pri opadanju lišća i u bubrenju pupova.'],
      ['Hrđa šljive', 'Smeđe-narančasti jastučići na naličju lista krajem ljeta; lišće rano opada.',
        'Pograbiti i ukloniti lišće u jesen. Obično ne treba prskati jer se javlja kasno, nakon berbe.']
    ],
    stetnici: [
      ['Šljivin savijač', 'Crvljivi plodovi koji ranije dobiju boju i opadaju.',
        'Feromonske klopke od svibnja. Otpale crvljive plodove skupljati. Tretman samo kod velikog ulova.'],
      ['Šljivine osice', 'Ličinke u mladim plodićima nakon cvatnje; plodići s rupicom i tamnom kašom otpadaju.',
        'Bijele ljepljive ploče objesiti prije cvatnje za praćenje leta. Tretman samo ako je ulov velik, odmah nakon otpadanja latica.'],
      ['Lisne uši', 'Kovrčanje lista na vrhovima mladica; prenose virus šarke.',
        'Otkinuti jako napadnute vrhove, poticati korisne kukce. Prskati samo kod jakog napada.']
    ]
  },
  smokva: {
    bolesti: [
      ['Hrđa smokve', 'Sitne smeđe-narančaste pjege na listu; lišće rano opada u vlažnim godinama.',
        'Pograbiti otpalo lišće, prozračiti krošnju. Prskanje obično nije potrebno.'],
      ['Trulež plodova', 'Siva plijesan i kiseo miris na zrelim plodovima nakon kiše.',
        'Brati redovito i ne ostavljati prezrele plodove na grani i tlu.']
    ],
    stetnici: [
      ['Štitaste uši', 'Voštani štitići na granama, ljepljiva medna rosa i čađavica.',
        'Manje kolonije ostrugati četkom. Uljni pripravak zimi samo kod jačeg napada i ako je dopušten.'],
      ['Ose i octene mušice', 'Izgrizeni i kiseli zreli plodovi.',
        'Brati čim plod omekša, skupljati otpale plodove; po potrebi zamke s octom.']
    ]
  },
  breskva: {
    bolesti: [
      ['Kovrčavost lista breskve', 'Listovi se u proljeće naboraju, zadebljaju i pocrvene, pa otpadnu.',
        'Kad se pojavi, kasno je za prskanje. Ključno je jedno dobro tempirano bakreno prskanje prije otvaranja pupova (kasna zima); jesensko prskanje pri opadanju lišća je dopuna, ne obveza. Zaražene listove ukloniti, a stablo zaliti i nahraniti kompostom da potjera novo lišće.'],
      ['Monilija', 'Sušenje cvjetova u kišnoj cvatnji i smeđa trulež plodova.',
        'Ukloniti mumije i suhe grančice, prorijediti plodove da se ne dodiruju. U kišnoj cvatnji zaštita cvijeta.'],
      ['Pepelnica breskve', 'Bijela brašnasta prevlaka na mladim listovima i plodovima; plodovi pucaju.',
        'Izrezati zaražene vrhove, krošnju držati prozračnom. Kod jakog napada sumporni pripravak od precvjetavanja.'],
      ['Šupljikavost lista i smolotok', 'Rupice na listu; smola (gumoza) na kori nakon rana, mraza i stresa.',
        'Pograbiti lišće, rezati po suhom vremenu i bez velikih rana. Kod jake šupljikavosti bakar pri opadanju lišća.']
    ],
    stetnici: [
      ['Zelena breskvina uš', 'Kovrčanje i uvijanje listova na vrhovima mladica u proljeće.',
        'Otkinuti napadnute vrhove, isprati vodom, poticati bubamare. Prskati samo kod jakog napada mladih stabala.'],
      ['Istočni breskvin savijač', 'Vrhovi mladica venu i suše se (ličinka u vrhu), a kasnije su plodovi crvljivi.',
        'Uvele vrhove odrezati i uništiti. Feromonske klopke za praćenje; tretman samo kod velikog ulova.']
    ]
  },
  tresnja: {
    bolesti: [
      ['Monilija', 'Sušenje cvjetova u kišnoj cvatnji i trulež plodova pred berbu.',
        'Ukloniti mumije i suhe grančice. U kišnoj cvatnji zaštita cvijeta; brati na vrijeme.'],
      ['Kozičavost lista trešnje', 'Sitne ljubičaste pjege na listu, lišće žuti i otpada već ljeti.',
        'Pograbiti i ukloniti otpalo lišće u jesen. Kod jake zaraze zaštita nakon berbe.'],
      ['Bakterijski rak', 'Udubljene rane na kori grana i debla s curenjem smole; grane se suše.',
        'Zaražene grane izrezati ljeti po suhom vremenu. Ako ga ima, bakar pri opadanju lišća.']
    ],
    stetnici: [
      ['Trešnjina muha', 'Crvljivi, mekani plodovi, uglavnom kod srednje kasnih i kasnih sorti.',
        'Žute ljepljive ploče postaviti prije očekivanog leta (svibanj) za praćenje. Brati sve plodove i ne ostavljati otpale ispod stabla. Kod jakog ulova tretman prema etiketi.'],
      ['Azijska octena mušica', 'Napada zrele, zdrave plodove: mekana udubljenja i crvi.',
        'Brati na vrijeme i redovito, skupljati otpale plodove; ostaviti zamke s octom.'],
      ['Crna trešnjina uš', 'Jako kovrčanje i crne kolonije na vrhovima mladica.',
        'Otkinuti napadnute vrhove; prskati samo kod jakog napada mladih stabala.'],
      ['Ptice', 'Kljucani plodovi pred berbu.',
        'Zaštitne mreže postaviti prije dozrijevanja, prije nego ptice počnu napadati.']
    ]
  },
  visnja: {
    bolesti: [
      ['Monilijska palež', 'Kod višnje vrlo jaka: cvjetovi i vrhovi grančica naglo se osuše odmah nakon cvatnje.',
        'Suhe vrhove odmah izrezati po suhom vremenu 10–15 cm u zdravo i ukloniti. U kišnoj cvatnji zaštita cvijeta, posebno ako je prošle godine bilo paleži.'],
      ['Kozičavost lista', 'Ljubičaste pjege, lišće žuti i rano otpada.',
        'Pograbiti lišće u jesen; kod jake zaraze zaštita nakon berbe.']
    ],
    stetnici: [
      ['Trešnjina muha i uši', 'Crvljivi plodovi i kovrčavi vrhovi mladica.',
        'Kao kod trešnje: žute ploče za praćenje, brati sve plodove, otkinuti napadnute vrhove.']
    ]
  },
  glog: {
    bolesti: [
      ['Bakterijska palež', 'Osušeni, pocrnjeli vrhovi izboja; glog može biti domaćin i izvor zaraze.',
        'Ne treba ga preventivno tretirati, ali u proljeće pregledati i osušene vrhove izrezati, posebno ako su blizu jabuka i krušaka.'],
      ['Pepelnica i hrđa', 'Bijela prevlaka (pepelnica), odnosno narančaste pjege (hrđa) na lišću.',
        'Obično ne treba ništa; kod jačeg napada izrezati zaražene vrhove.']
    ],
    stetnici: [
      ['Gusjenice i uši', 'Pojedeno ili kovrčavo lišće, povremeno.',
        'Obično bez većih šteta; gnijezda gusjenica ručno ukloniti.']
    ]
  },
  drenak: {
    bolesti: [
      ['Rijetko', 'Drenak gotovo nema ozbiljnih bolesti.', 'Ništa posebno; samo uklanjati suhe grane.']
    ],
    stetnici: [
      ['Ptice i uši', 'Ptice jedu zrele plodove; povremeno lisne uši.', 'Brati na vrijeme ili tresti na plahtu; uši obično ne treba suzbijati.']
    ]
  },
  kupina: {
    bolesti: [
      ['Siva plijesan', 'Siva paperjasta trulež plodova u kišnom vremenu.',
        'Prozračan uzgoj na žici, ne pregusti izboji. Brati često i ukloniti trule plodove.'],
      ['Hrđa kupine', 'Narančasti jastučići na naličju lista, lišće rano otpada.',
        'Ukloniti zaraženo lišće i izboje nakon berbe; prozračiti grm.'],
      ['Pjegavost izboja', 'Ljubičaste do sive pjege na izbojima; izboji pucaju i suše se.',
        'Zaražene izboje izrezati i ukloniti. Kod jakog napada bakar u bubrenju pupova.']
    ],
    stetnici: [
      ['Kupinova grinja', 'Dio bobica u plodu ostaje crven i tvrd.',
        'Nakon berbe izrezati sve izboje koji su rodili; kod jakog napada zaštita u proljeće.'],
      ['Azijska octena mušica', 'Mekani, kiseli plodovi s crvima.',
        'Brati često (svaka 2 dana), ne ostavljati prezrele plodove, zamke s octom.']
    ]
  },
  ribizl: {
    bolesti: [
      ['Pepelnica', 'Bijela pa smeđa prevlaka na vrhovima izboja i bobicama.',
        'Zaražene vrhove odrezati i grm prozračiti rezidbom. Zaštita (npr. sumporni pripravci) samo ako se širi.'],
      ['Pjegavost lista (antraknoza)', 'Sitne smeđe pjege na listu, lišće rano otpada već ljeti.',
        'Pograbiti i ukloniti otpalo lišće. Ne zalijevati po listu.'],
      ['Stupičasta hrđa', 'Narančasti stupići na naličju lista krajem ljeta.',
        'Ukloniti zaraženo lišće. Prijelazni domaćin je borovac (bor) – ne saditi ga u blizini.']
    ],
    stetnici: [
      ['Ribizova grinja pupova', 'Pupovi nabreknu i postanu okrugli; ne otvaraju se.',
        'U mirovanju otkinuti i uništiti nabrekle pupove; kod jakog napada izrezati cijeli zaraženi izboj.'],
      ['Ribizov staklokrilac', 'Ličinka u srži izboja (tamna srž); izboj vene i suši se.',
        'Takve izboje izrezati do zdravog (svijetle srži) i uništiti.'],
      ['Lisne uši', 'Crvenkasta mjehurasta ispupčenja na listu.',
        'Obično ne treba ništa; jako napadnute vrhove otkinuti.']
    ]
  },
  dud2: {
    bolesti: [
      ['Pjegavost lista i bakterijska palež duda', 'Tamne pjege na listu i pocrnjeli vrhovi izboja u vlažnim godinama.',
        'Pograbiti lišće, izrezati osušene vrhove po suhom vremenu. Prskanje obično nije potrebno.']
    ],
    stetnici: [
      ['Dudovac (američki dudovac)', 'Gusjenice u gnijezdima od bijele mreže pojedu lišće.',
        'Gnijezda odrezati i uništiti dok su mala (svibanj–kolovoz); pregledavati stablo svaka 2–3 tjedna.'],
      ['Štitaste uši', 'Štitići na granama i medna rosa, povremeno.',
        'Manje kolonije ostrugati; kod jakog napada zimsko uljno prskanje.']
    ]
  },
  vinova_loza: {
    bolesti: [
      ['Peronospora (plamenjača)', 'Uljne pjege na licu lista i bijela prevlaka na naličju; grozdovi posmeđe i suše se.',
        'Zelenom rezidbom držati trs prozračnim. U kišnim razdobljima štititi bakrenim ili drugim pripravcima prema kiši i porastu. Pravilo 3 × 10 je samo orijentacija za početak rizika.'],
      ['Pepelnica', 'Pepeljasta prevlaka na listu i bobicama; bobice pucaju. Pogoduje joj toplo vrijeme sa sparinom.',
        'Prozračiti zonu grozda, sumporni pripravci od 3–5 listova do zatvaranja grozda prema riziku.'],
      ['Siva plijesan', 'Siva trulež zbijenih grozdova u kišnoj jeseni.',
        'Prorijediti lišće oko grozdova (umjereno), ne ozljeđivati bobice, brati na vrijeme.'],
      ['Crna pjegavost', 'Crne pjege i pukotine na osnovi mladica, bijelo drvo.',
        'Glavna mjera je uklanjanje zaraženog prošlogodišnjeg drva pri rezidbi; kod jakog napada zaštita u bubrenju.'],
      ['Crna trulež', 'Smeđe pjege s tamnim rubom na listu; bobice se smežuraju u tvrde crne mumije.',
        'Mumije ukloniti s trsa i s tla; zaštita kao protiv peronospore.']
    ],
    stetnici: [
      ['Grožđani moljci', 'Ličinke oštećuju cvat i bobice, što otvara put sivoj plijesni.',
        'Feromonske klopke za praćenje; tretman samo kod velikog ulova.'],
      ['Grinje (erinoza)', 'Ispupčenja na licu lista s bijelom pustenastom prevlakom na naličju.',
        'Obično bezopasno; kod jakog napada zaštita u bubrenju iduće godine.'],
      ['Američki cvrčak i zlatna žutica', 'Listovi se uvijaju i crvene ili žute, mladice ne odrvene; cvrčak prenosi karantensku bolest.',
        'Sumnju odmah prijaviti savjetodavnoj službi. Zaražene trsove prema uputi ukloniti.']
    ]
  },
  orah: {
    bolesti: [
      ['Bakterijska palež oraha', 'Crne pjege na listu, mladim plodovima i resama; plodovi pocrne i otpadnu.',
        'Ako ga je bilo, bakreni tretman u kišnom listanju i cvatnji. Pocrnjele plodove ukloniti.'],
      ['Antraknoza (smeđa pjegavost)', 'Okrugle smeđe pjege na listu, lišće rano otpada.',
        'Pograbiti i ukloniti lišće u jesen (na njemu prezimljuje).']
    ],
    stetnici: [
      ['Orahova muha', 'Zelena ljuska pocrni i postane ljepljiva, a jezgra je tamna.',
        'Žute ljepljive ploče postaviti prije očekivanog leta (obično od kraja lipnja). Zaražene ljuske i plodove skupljati i uklanjati.'],
      ['Jabučni savijač', 'Crvljivi plodovi oraha koji ranije otpadaju.',
        'Skupljati otpale plodove; feromonske klopke za praćenje.']
    ]
  },
  kivi: {
    bolesti: [
      ['Bakterijski rak kivija', 'Smeđe pjege sa žutim rubom na listu, sušenje izboja i cvjetova, a na kori rane iz kojih curi crvenkasti ili bjelkasti iscjedak.',
        'Ozbiljna bolest: sumnju prijaviti savjetodavnoj službi. Zaražene dijelove izrezati po suhom vremenu, alat dezinficirati. Ako je bilo pjega, bakar u proljeće.'],
      ['Trulež korijena', 'Biljka vene i žuti unatoč vlažnom tlu.',
        'Saditi na ocjedito mjesto ili blago povišenu gredicu; ne prelijevati, posebno na glinastom tlu.'],
      ['Siva plijesan', 'Trulež cvjetova i plodova u kišnom vremenu i kasnije u skladištu.',
        'Prozračna krošnja (ljetna rezidba), čuvati samo zdrave plodove.']
    ],
    stetnici: [
      ['Mramorasta stjenica', 'Udubljenja i plutasta mjesta ispod kore ploda.',
        'Pratiti od ljeta i ručno skupljati (ujutro, u posudu sa sapunicom).'],
      ['Štitaste uši', 'Štitići na granama, povremeno.', 'Manje kolonije ostrugati.'],
      ['Mačke', 'Izgrizeni i izgrebeni mladi izboji i kora.', 'Mlade sadnice zaštititi mrežom ili ogradom.']
    ]
  }
};

// Borovnica (nova vrsta)
const GLINA = ' Na glinastom tlu voda se dugo zadržava: prije zalijevanja provjeriti vlagu na 10–20 cm i ne prelijevati.';
if (!enc.vrste.some(v => v.id === 'borovnica')) {
  const borovnica = {
    id: 'borovnica',
    naziv: 'Borovnica',
    latinski: 'Vaccinium corymbosum (visokogrma borovnica)',
    emoji: '🫐',
    opis: 'Grm visine 1,5–2 m koji traži **kiselo tlo** (pH oko 4,5–5,5) – to je najvažniji uvjet uspjeha. Na običnom, glinastom ili vapnenastom tlu raste slabo i lišće žuti, pa se sadi u povišenu gredicu ili veliku posudu s kiselim supstratom (treset ili supstrat za borovnice, kora četinjača). Za bolji rod saditi barem dvije sorte. Puni rod od 4.–5. godine.',
    voda: 'Srednja do visoka: plitko, vlaknasto korijenje ne podnosi isušivanje. Malčirati korom četinjača i redovito zalijevati, najbolje kišnicom (vodovodna voda je često vapnenasta i diže pH).' + GLINA,
    orezivanje: {
      kada: 'Kasna zima, veljača–ožujak, prije kretanja vegetacije.',
      kako: 'Prve 2–3 godine samo ukloniti slabe izboje (i cvjetne pupove, da grm ojača). Kasnije svake godine ukloniti 1–2 najstarija izboja (starije od 5–6 godina) pri tlu, te slabe, polegle i križane grane. Ostaviti 6–10 jakih izboja različite starosti.'
    },
    gnojidba: 'Ne gnojiti svježim stajskim gnojem ni vapnom. U proljeće malo gnojiva za borovnice / kiselo tlo ili kompost od lišća i kore četinjača; malč od kore četinjača obnavljati svake godine.',
    bolesti: [],
    stetnici: [],
    zastita: [
      { kada: 'Mirovanje', sto: 'Rezidba; ukloniti suhe izboje i izboje s pjegama.' },
      { kada: 'Proljeće', sto: 'Provjeriti boju lišća (žutilo = pH previsok); obnoviti malč od kore četinjača.' },
      { kada: 'Cvatnja', sto: 'U kišnom vremenu pratiti sivu plijesan i mumifikaciju plodova.' },
      { kada: 'Dozrijevanje', sto: 'Mreže protiv ptica; brati često zbog octene mušice.' }
    ],
    berba: 'Lipanj–kolovoz, ovisno o sorti, u više navrata. Bobicu brati nekoliko dana nakon što posve poplavi – tada je najslađa i lako se odvaja.'
  };
  const ostaloIdx = enc.vrste.findIndex(v => v.id === 'ostalo');
  enc.vrste.splice(ostaloIdx === -1 ? enc.vrste.length : ostaloIdx, 0, borovnica);
}
P.borovnica = {
  bolesti: [
    ['Kloroza (previsok pH tla)', 'Lišće žuti između žila, a žile ostaju zelene; grm slabo raste. Nije bolest nego posljedica nekiselog tla ili vapnenaste vode.',
      'Provjeriti pH tla (komplet iz vrtnog centra). Zalijevati kišnicom, malčirati korom četinjača, dodati supstrat za borovnice ili sumpor za zakiseljavanje prema uputi.'],
    ['Mumifikacija plodova (monilija borovnice)', 'Bobice pobijele ili poružičaste, smežuraju se i otpadaju kao tvrde „mumije”; vrhovi mladica mogu venuti.',
      'Skupiti mumificirane bobice s grma i tla, obnoviti malč preko njih u proljeće. Kod jake zaraze zaštita u cvatnji.'],
    ['Siva plijesan', 'Siva trulež cvjetova i zrelih bobica u kišnom vremenu.',
      'Prozračan grm (rezidba), brati često, ukloniti trule bobice.'],
    ['Rak i sušenje izboja', 'Crvenkasto-smeđe pjege i rane na izbojima koji se zatim suše.',
      'Zaražene izboje izrezati u zdravo po suhom vremenu i ukloniti.']
  ],
  stetnici: [
    ['Ptice', 'Pojedene i kljucane zrele bobice.', 'Mreža preko grmova prije dozrijevanja.'],
    ['Azijska octena mušica', 'Mekane, kisele bobice s crvima pred kraj berbe.', 'Brati često i do kraja, ne ostavljati prezrele plodove; zamke s octom.'],
    ['Lisne uši', 'Kovrčanje vrhova mladica.', 'Obično ne treba ništa; jako napadnute vrhove otkinuti.']
  ]
};

const missing = [];
enc.vrste.forEach(v => {
  const p = P[v.id];
  if (!p) { if (v.id !== 'ostalo') missing.push(v.id); return; }
  v.bolesti = p.bolesti.map(([naziv, prepoznaj, rjesenje]) => ({ naziv, prepoznaj, rjesenje }));
  v.stetnici = p.stetnici.map(([naziv, prepoznaj, rjesenje]) => ({ naziv, prepoznaj, rjesenje }));
});
if (missing.length) throw new Error('Nema podataka za: ' + missing.join(', '));
// u opisu borovnice bez markdowna
const b = enc.vrste.find(v => v.id === 'borovnica');
b.opis = b.opis.replace(/\*\*/g, '');
fs.writeFileSync(path, JSON.stringify(enc, null, 2) + '\n');
console.log('ok:', enc.vrste.length, 'vrsta, sve bolesti/štetnici imaju prepoznaj + rjesenje');
