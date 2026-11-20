// Jednokratno: pregled pripravaka za prskanje (enciklopedija -> meta.pripravci).
// "kljuc" je regularni izraz kojim se u rješenjima bolesti/štetnika traži gdje pripravak pomaže.
// Pokretanje (iz mape projekta): node scripts/pripravci-2026-11.cjs
const fs = require('fs');
const path = 'data/enciklopedija.json';
const enc = JSON.parse(fs.readFileSync(path, 'utf8'));

enc.meta.pripravci = {
  uvod: 'Za hobi voćnjak obično su dovoljna tri osnovna pripravka: bakreni, uljni i sumporni. Ostalo se koristi samo kad problem stvarno postoji. Nazivi su vrste pripravaka, ne komercijalni proizvodi: na etiketi uvijek provjeri djelatnu tvar, dopuštenu primjenu na toj vrsti, dozu i karencu, i koristi zaštitnu opremu.',
  popis: [
    {
      id: 'bakar', emoji: '🟦', naziv: 'Bakreni pripravci', osnovni: true, tip: 'bolesti',
      kljuc: 'bakr|bakar',
      stoJe: 'Pripravci na bazi bakra (npr. bakreni oksiklorid ili hidroksid). Djeluju preventivno protiv gljivičnih i bakterijskih bolesti – moraju biti na biljci prije zaraze. Neki pripravci kombiniraju bakar i ulje (npr. poznati kao „modro ulje”).',
      kada: 'Opadanje lišća u jesen i bubrenje pupova u kasnu zimu (najvažnije za breskvu, šljivu, trešnju, višnju, kupinu); kod vinove loze tijekom sezone u kišnim razdobljima.',
      pazi: 'Ne prskati u punoj cvatnji ni po mladom lišću osjetljivih vrsta u hladnom i vlažnom vremenu (ožegotine). Bakar se nakuplja u tlu – ne pretjerivati s brojem prskanja.'
    },
    {
      id: 'ulje', emoji: '🛢️', naziv: 'Uljni pripravci (mineralno / parafinsko ulje)', osnovni: true, tip: 'stetnici',
      kljuc: 'uljn|\\bulje',
      stoJe: 'Ulje prekriva i guši prezimljujuća jaja i stadije štetnika na kori: lisne uši, grinje, štitaste uši, kruškina buha.',
      kada: 'U mirovanju do bubrenja pupova (veljača–ožujak), po suhom danu bez mraza (iznad oko 5 °C). Samo kad je prethodne godine bilo jačeg napada.',
      pazi: 'Ne miješati i ne prskati u kratkom razmaku sa sumpornim pripravcima. Ne prskati po otvorenim pupovima i cvijetu.'
    },
    {
      id: 'sumpor', emoji: '🟨', naziv: 'Sumporni pripravci (močivi sumpor)', osnovni: true, tip: 'bolesti',
      kljuc: 'sumpor',
      iskljuci: 'zakiselj',
      stoJe: 'Klasično sredstvo protiv pepelnice; usput djeluje i na neke grinje.',
      kada: 'Od pupanja do nakon cvatnje kod jabuke, breskve i ribizla, a kod vinove loze od 3–5 listova do zatvaranja grozda – kad se pepelnica pojavi ili je rizik velik.',
      pazi: 'Ne prskati iznad oko 28–30 °C ni na jakom suncu (ožegotine). Neke sorte (npr. pojedine jabuke i ribizli) su osjetljive na sumpor – provjeriti etiketu.'
    },
    {
      id: 'fungicid', emoji: '🧪', naziv: 'Ostali fungicidi (prema etiketi)', osnovni: false, tip: 'bolesti',
      kljuc: 'zaštit|štiti',
      iskljuci: 'bakr|bakar|sumpor',
      stoJe: 'Specifični pripravci za pojedine bolesti kad bakar ili sumpor nisu prikladni – npr. zaštita cvijeta od monilije u kišnoj cvatnji ili krastavosti nakon cvatnje.',
      kada: 'Samo u rizičnim razdobljima (kišna cvatnja, dugo vlažno lišće), i to kod vrsta koje su prethodnih godina imale tu bolest.',
      pazi: 'Birati pripravak registriran za tu vrstu i bolest; poštovati karencu pred berbu.'
    },
    {
      id: 'insekticid', emoji: '🐛', naziv: 'Insekticidi (ciljano)', osnovni: false, tip: 'stetnici',
      kljuc: 'tretman|prskati',
      iskljuci: 'uljn|\\bulje',
      stoJe: 'Pripravci protiv štetnika (savijači, osice, muhe, uši). Za gusjenice postoje i biološki pripravci (npr. na bazi bakterije Bacillus thuringiensis).',
      kada: 'Samo kad klopke ili pregled pokažu jak napad, i to u pravom trenutku (npr. osice odmah nakon cvatnje).',
      pazi: 'Ne prskati u cvatnji (pčele). Mnoge štetnike drže pod kontrolom korisni kukci – širokospektralni insekticidi ih uništavaju.'
    },
    {
      id: 'pomagala', emoji: '🧰', naziv: 'Pomagala bez prskanja', osnovni: false, tip: 'sve',
      kljuc: 'klopk|ploč|mrež|zamk',
      stoJe: 'Feromonske klopke (savijači), žute i bijele ljepljive ploče (muhe, osice), mreže protiv ptica, zamke s octom (octena mušica), škare i alkohol za dezinfekciju alata.',
      kada: 'Klopke i ploče postaviti prije očekivanog leta štetnika (proljeće–ljeto), mreže prije dozrijevanja.',
      pazi: 'Klopke i ploče služe uglavnom za praćenje – pokazuju kada i treba li uopće reagirati.'
    }
  ],
  // Rješenja bez ijednog od ovih izraza računaju se kao "bez prskanja"
  prskanjeKljuc: 'bakr|bakar|sumpor|uljn|\\bulje|zaštit|štiti|tretman|prskati|prskanje'
};

fs.writeFileSync(path, JSON.stringify(enc, null, 2) + '\n');
console.log('ok:', enc.meta.pripravci.popis.length, 'pripravaka');
