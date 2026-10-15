// @ts-nocheck -- strict index checks only; runtime-safe
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/* =========================================================
   Övningskörning inför körkortet – slumpade lektioner och scenarier
   ========================================================= */

type V2 = [number, number];
type Turn = "straight" | "left" | "right";
type Control = "none" | "yield" | "stop" | "main" | "light" | "round" | "exit" | "infart" | "finish";
type SignId =
  | "yield" | "stop" | "main" | "mainEnd" | "crosswalk" | "children" | "railWarn" | "railCross"
  | "noParking" | "noStopping" | "lightWarn" | "roundabout" | "speed30" | "speed40" | "speed50";
type Task = "back" | "front" | "parallel";
type CondId = "klart" | "mulet" | "dimma" | "skymning";

type Item =
  | { at: number; kind: "speed"; kmh: 30 | 40 | 50; quiz?: string }
  | { at: number; kind: "sign"; sign: SignId; quiz?: string }
  | { at: number; kind: "crosswalk"; from: 1 | -1; child?: boolean; ped: boolean; quiz?: string }
  | { at: number; kind: "walker"; from: 1 | -1 }
  | { at: number; kind: "rail"; quiz?: boolean }
  | { at: number; kind: "quiz"; quiz: string };

interface Leg {
  len: number; turn: Turn; control: Control;
  cross?: "right" | "left"; crossYields?: boolean; oncoming?: boolean; circ?: boolean; cyclist?: boolean;
  items: Item[]; quizAfter?: string;
}

interface Quiz { sign?: SignId; q: string; options: string[]; correct: number; explain: string }

/* ---------------- Lektioner och förhållanden ---------------- */
const CONDITIONS: Record<CondId, { name: string; sky: number; near: number; far: number; sun: number; hemi: number; intro: string }> = {
  klart: { name: "Klart väder", sky: 0xc9dbe8, near: 40, far: 650, sun: 1.6, hemi: 1.0, intro: "Det är klart väder idag." },
  mulet: { name: "Mulet", sky: 0xb4bcc4, near: 30, far: 450, sun: 0.7, hemi: 0.9, intro: "Det är mulet idag." },
  dimma: { name: "Dimma", sky: 0xc3c7cb, near: 5, far: 110, sun: 0.4, hemi: 0.85, intro: "Det är dimmigt idag och sikten är dålig." },
  skymning: { name: "Skymning", sky: 0x5b6378, near: 20, far: 260, sun: 0.35, hemi: 0.5, intro: "Det börjar skymma." },
};

interface Lesson {
  id: string; title: string; desc: string;
  pool: Control[]; must: Control[]; count: [number, number];
  feats: string[]; featCount: [number, number];
  cyc: number; ped: number; rail: "maybe" | "force" | "never";
  tasks: Task[]; maneuvers: number; help: boolean; quiz: boolean; conds: CondId[];
}

const ALL_C: Control[] = ["none", "yield", "stop", "main", "light", "round"];
const LESSONS: Lesson[] = [
  { id: "mixed", title: "Blandad stadskörning", desc: "Lite av allt: korsningar, skyltar, gående och parkering.", pool: ALL_C, must: ALL_C, count: [7, 9], feats: ["crosswalk", "school", "sign", "rail", "limit", "quiz"], featCount: [1, 3], cyc: 0.6, ped: 0.8, rail: "maybe", tasks: ["back", "front", "parallel"], maneuvers: 1, help: true, quiz: true, conds: ["klart", "klart", "mulet", "skymning"] },
  { id: "junctions", title: "Korsningar och företräde", desc: "Högerregeln, väjningsplikt, stopplikt och huvudled i många varianter.", pool: ["none", "none", "yield", "stop", "main", "yield", "stop", "none"], must: ["none", "yield", "stop", "main"], count: [8, 10], feats: ["crosswalk", "sign", "quiz"], featCount: [0, 2], cyc: 0.5, ped: 0.7, rail: "never", tasks: ["front"], maneuvers: 1, help: true, quiz: true, conds: ["klart", "mulet"] },
  { id: "round", title: "Cirkulationsplatser", desc: "Infart, val av utfart och blinkers i cirkulationsplatser.", pool: ["round", "round", "round", "yield", "none"], must: ["round", "round", "round"], count: [6, 8], feats: ["crosswalk", "sign", "quiz"], featCount: [0, 2], cyc: 0.4, ped: 0.7, rail: "never", tasks: ["back"], maneuvers: 1, help: true, quiz: true, conds: ["klart", "mulet"] },
  { id: "vulnerable", title: "Gående och cyklister", desc: "Övergångsställen, skolområden och cyklister i döda vinkeln.", pool: ["none", "yield", "main", "light", "round"], must: ["none", "main"], count: [7, 9], feats: ["crosswalk", "crosswalk", "school", "school", "sign"], featCount: [2, 3], cyc: 0.95, ped: 1, rail: "never", tasks: ["parallel"], maneuvers: 1, help: true, quiz: true, conds: ["klart", "mulet", "skymning"] },
  { id: "signs", title: "Vägmärken och hastighet", desc: "Många skyltar och hastighetsbyten. Ingen säger vad som gäller, du måste vara uppmärksam.", pool: ALL_C, must: ["main", "yield", "stop"], count: [7, 9], feats: ["limit", "limit", "school", "sign", "sign", "rail", "quiz"], featCount: [2, 3], cyc: 0.4, ped: 0.6, rail: "maybe", tasks: ["front", "back"], maneuvers: 1, help: false, quiz: true, conds: ["klart", "mulet"] },
  { id: "signals", title: "Trafiksignaler och järnväg", desc: "Gult och rött ljus, vänstersväng vid signal och järnvägskorsning med bommar.", pool: ["light", "light", "light", "main", "yield"], must: ["light", "light"], count: [6, 8], feats: ["crosswalk", "sign", "quiz"], featCount: [0, 2], cyc: 0.4, ped: 0.6, rail: "force", tasks: ["back"], maneuvers: 1, help: true, quiz: true, conds: ["klart", "skymning"] },
  { id: "weather", title: "Svåra förhållanden", desc: "Dimma eller skymning. Anpassa farten efter sikten.", pool: ALL_C, must: ["none", "round", "light"], count: [7, 9], feats: ["crosswalk", "school", "sign", "limit"], featCount: [1, 2], cyc: 0.6, ped: 0.9, rail: "maybe", tasks: ["front", "parallel"], maneuvers: 1, help: true, quiz: false, conds: ["dimma", "skymning"] },
  { id: "maneuver", title: "Manövrering och parkering", desc: "Kort körning och sedan tre olika parkeringsövningar.", pool: ["none", "yield"], must: [], count: [2, 3], feats: ["crosswalk"], featCount: [0, 1], cyc: 0.3, ped: 0.6, rail: "never", tasks: ["back", "front", "parallel"], maneuvers: 3, help: true, quiz: false, conds: ["klart", "mulet"] },
  { id: "exam", title: "Provkörning", desc: "Som ett riktigt körprov: ingen regelhjälp, inga frågor och allt kan hända.", pool: ALL_C, must: ALL_C, count: [8, 10], feats: ["crosswalk", "school", "sign", "rail", "limit"], featCount: [1, 2], cyc: 0.6, ped: 0.8, rail: "maybe", tasks: ["back", "front", "parallel"], maneuvers: 1, help: false, quiz: false, conds: ["klart", "mulet", "dimma", "skymning"] },
];

/* ---------------- Teorifrågor ---------------- */
const QUIZ: Record<string, Quiz> = {
  speed30: { sign: "speed30", q: "Vad betyder skylten?", options: ["Högsta tillåtna hastighet är 30 km/h", "Rekommenderad hastighet är 30 km/h", "Lägsta tillåtna hastighet är 30 km/h", "Gäller bara när barn syns"], correct: 0, explain: "Hastighetsbegränsningen gäller från skylten fram till nästa hastighetsskylt." },
  speed40: { sign: "speed40", q: "Vad betyder skylten?", options: ["Högsta tillåtna hastighet är 40 km/h", "Rekommenderad hastighet är 40 km/h", "Lägsta tillåtna hastighet är 40 km/h", "Hastighetsbegränsningen upphör"], correct: 0, explain: "Hastighetsbegränsningen gäller från skylten fram till nästa hastighetsskylt." },
  speed50: { sign: "speed50", q: "Vad betyder skylten?", options: ["Högsta tillåtna hastighet är 50 km/h", "Rekommenderad hastighet är 50 km/h", "Lägsta tillåtna hastighet är 50 km/h", "Hastighetsbegränsningen upphör"], correct: 0, explain: "Hastighetsbegränsningen gäller från skylten fram till nästa hastighetsskylt." },
  noParking: { sign: "noParking", q: "Vad får du göra där den här skylten står?", options: ["Stanna en kort stund för att släppa av en passagerare", "Parkera i högst 15 minuter", "Ingenting, du får inte stanna alls", "Parkera om du har varningsblinkers på"], correct: 0, explain: "Parkering förbjuden: du får inte parkera, men du får stanna kort för att släppa av eller på någon eller för att lasta." },
  noStopping: { sign: "noStopping", q: "Vad betyder skylten?", options: ["Förbud att stanna och parkera", "Parkering förbjuden men du får stanna kort", "Förbud mot infart", "Parkering tillåten"], correct: 0, explain: "Du får inte stanna alls, utom för att undvika fara eller om trafiken kräver det." },
  rightRule: { q: "Vem har företräde i en korsning utan vägmärken eller trafiksignaler?", options: ["Den som kommer från höger", "Den som kommer från vänster", "Den som kör fortast", "Den som kör på den bredaste vägen"], correct: 0, explain: "Högerregeln: du har väjningsplikt mot fordon som kommer från höger." },
  crosswalk: { sign: "crosswalk", q: "En gående är på väg ut på ett obevakat övergångsställe. Vad ska du göra?", options: ["Sakta in och stanna så att den gående kan gå över", "Tuta och köra förbi", "Köra förbi om du hinner först", "Blinka med helljuset"], correct: 0, explain: "Du ska anpassa farten och lämna företräde åt gående som är på eller precis ska gå ut på övergångsstället." },
  yield: { sign: "yield", q: "Vad innebär skylten vid korsningen du nyss körde igenom?", options: ["Lämna företräde åt korsande trafik, men du behöver inte stanna om det är fritt", "Du måste alltid stanna helt", "Du kör på huvudled", "Förbud att köra in"], correct: 0, explain: "Väjningsplikt: släpp fram korsande trafik. Är vägen fri får du köra utan att stanna." },
  stop: { sign: "stop", q: "Vad måste du göra vid stopplikt?", options: ["Stanna helt vid stopplinjen och sedan lämna företräde", "Sakta in och köra om det är fritt", "Stanna bara om det kommer bilar", "Tuta innan du kör ut"], correct: 0, explain: "Vid stopplikt ska du alltid stanna helt, även om vägen är fri, och sedan släppa fram korsande trafik." },
  children: { sign: "children", q: "Vad varnar skylten för?", options: ["Barn som kan springa ut i vägen, till exempel nära en skola", "Övergångsställe", "Gångfartsområde", "Lekplats där du inte får köra"], correct: 0, explain: "Varning för barn. Sänk farten och var beredd på att barn kan dyka upp plötsligt." },
  yellow: { q: "Vad betyder gult ljus i en trafiksignal?", options: ["Stanna om du kan göra det på ett säkert sätt", "Öka farten så du hinner över", "Kör, gult betyder samma som grönt", "Stanna bara om det finns gående"], correct: 0, explain: "Gult ljus betyder stopp. Du får bara köra vidare om du inte kan stanna på ett säkert sätt." },
  leftTurn: { q: "Du svänger vänster och en mötande bil kör rakt fram. Vem har företräde?", options: ["Den mötande bilen", "Du, eftersom du blinkar", "Den som kom först till korsningen", "Den som har haft grönt längst"], correct: 0, explain: "Vid vänstersväng ska du lämna företräde åt mötande trafik som kör rakt fram eller svänger höger." },
  leftTurnPrep: { q: "Vad ska du göra innan du svänger vänster?", options: ["Kolla spegeln och döda vinkeln, blinka vänster i god tid, placera dig nära mittlinjen och släpp fram mötande", "Blinka först när du är mitt i korsningen", "Placera dig längst till höger och svänga snabbt", "Tuta för att visa att du svänger"], correct: 0, explain: "Spegel, döda vinkeln, blinkers, placering och anpassad fart. Släpp sedan fram mötande trafik och gående." },
  rightTurn: { q: "Vad ska du göra innan du svänger höger?", options: ["Kolla spegeln och döda vinkeln åt höger, blinka i god tid, hålla till höger och släppa fram cyklister och gående", "Svänga ut åt vänster först för att få plats", "Bara blinka, cyklister måste stanna för dig", "Öka farten för att komma före cyklisten"], correct: 0, explain: "Cyklister till höger om dig kan hamna i döda vinkeln. Titta över höger axel och släpp fram dem." },
  main: { sign: "main", q: "Vad betyder skylten?", options: ["Du kör på huvudled och trafik från sidovägar ska släppa fram dig", "Väjningsplikt", "Varning för korsning", "Parkering"], correct: 0, explain: "Huvudled. Trafik från anslutande vägar har väjningsplikt eller stopplikt. Vid vänstersväng ska du ändå släppa fram mötande." },
  mainEnd: { sign: "mainEnd", q: "Vad betyder skylten?", options: ["Huvudleden upphör och vanliga företrädesregler gäller igen", "Du kör in på huvudled", "Vägen tar slut", "Hastighetsgränsen upphör"], correct: 0, explain: "Huvudled upphör. Efter skylten kan till exempel högerregeln gälla i korsningar." },
  railWarn: { sign: "railWarn", q: "Vad varnar skylten för?", options: ["Järnvägskorsning med bommar", "Järnvägskorsning utan bommar", "Vägarbete", "Bro som kan öppnas"], correct: 0, explain: "Varning för järnvägskorsning med bommar. Stanna när ljussignalerna blinkar eller bommarna fälls." },
  railCross: { sign: "railCross", q: "Vad anger kryssmärket vid spåret?", options: ["Platsen för en järnvägskorsning", "Korsning med huvudled", "Stopplikt", "Förbud mot att stanna"], correct: 0, explain: "Kryssmärket står vid själva järnvägskorsningen. Ett enkelt kryss betyder ett spår, ett dubbelt kryss flera spår." },
  lightWarn: { sign: "lightWarn", q: "Vad varnar skylten för?", options: ["Trafiksignal", "Järnvägskorsning", "Vägarbete", "Övergångsställe"], correct: 0, explain: "Varning för trafiksignal. Var beredd på att signalen kan slå om till gult eller rött." },
  roundabout: { sign: "roundabout", q: "Vad betyder skylten?", options: ["Cirkulationsplats, kör moturs runt mitten", "Enkelriktad trafik", "Påbjuden körriktning rakt fram", "Vändplats"], correct: 0, explain: "Cirkulationsplats. Du kör moturs, alltså till höger om mittrutan." },
  roundYield: { q: "Du kör fram till en cirkulationsplats med väjningsplikt. Vem har företräde?", options: ["Fordon som redan kör i cirkulationsplatsen", "Du, eftersom du kommer från höger", "Den som kör den största vägen", "Den som blinkar först"], correct: 0, explain: "Väjningsplikten gäller mot trafiken som redan är inne i cirkulationsplatsen." },
  roundExit: { q: "När ska du blinka höger i en cirkulationsplats?", options: ["Innan du kör ut, när du passerat utfarten före den du ska ta", "Hela tiden medan du kör runt", "Aldrig, man blinkar inte i cirkulationsplatser", "Bara om det finns gående"], correct: 0, explain: "Blinka höger innan du kör ut så att andra förstår vilken utfart du tar." },
  utfart: { q: "Vad gäller när du kör ut från en parkeringsplats eller gård till en väg?", options: ["Du har väjningsplikt mot all trafik på vägen, även gående och cyklister", "Högerregeln gäller", "Du har alltid företräde", "Du har bara väjningsplikt mot bilar"], correct: 0, explain: "Utfartsregeln: när du kör ut från parkeringsplats, gård, bensinstation eller liknande ska du släppa fram alla på vägen." },
  infart: { q: "Du svänger in på en parkering och korsar en trottoar. Vad gäller?", options: ["Du ska lämna företräde åt gående på trottoaren", "Gående ska stanna för dig", "Du får köra om du tutar", "Ingen särskild regel gäller"], correct: 0, explain: "När du korsar en gångbana ska du släppa fram de gående." },
  g_promille: { q: "Vilken är den högsta tillåtna alkoholhalten i blodet när du kör bil i Sverige?", options: ["0,2 promille", "0,5 promille", "0,8 promille", "1,0 promille"], correct: 0, explain: "Gränsen för rattfylleri är 0,2 promille. Det säkraste är att aldrig köra efter att ha druckit." },
  g_brake: { q: "Om du fördubblar hastigheten, hur förändras bromssträckan ungefär?", options: ["Den blir ungefär fyra gånger så lång", "Den blir dubbelt så lång", "Den blir lika lång", "Den blir hälften så lång"], correct: 0, explain: "Bromssträckan ökar med kvadraten på hastigheten. Dubbel fart ger ungefär fyra gånger så lång bromssträcka." },
  g_lights: { q: "När ska du ha belysning tänd på bilen?", options: ["Alltid när du kör, även på dagen", "Bara när det är mörkt", "Bara utanför tätort", "Bara vid dåligt väder"], correct: 0, explain: "I Sverige ska du alltid köra med halvljus eller varselljus. När det är mörkt eller dålig sikt ska du ha halvljus." },
  g_phone: { q: "Får du hålla mobilen i handen och prata medan du kör?", options: ["Nej, det är förbjudet att hålla mobilen i handen under körning", "Ja, om du kör långsamt", "Ja, inom tättbebyggt område", "Ja, om samtalet är kort"], correct: 0, explain: "Det är förbjudet att hålla mobilen i handen när du kör. Använd handsfree och undvik samtal som tar fokus." },
  g_gap: { q: "Hur stort avstånd bör du minst hålla till fordonet framför vid normal körning?", options: ["Minst 3 sekunder", "1 sekund", "En billängd", "10 meter oavsett fart"], correct: 0, explain: "Tresekundersregeln ger dig tid att reagera och bromsa." },
  g_parkCw: { q: "Hur nära ett obevakat övergångsställe får du parkera?", options: ["Inte på det eller inom 10 meter före det", "Inte inom 2 meter", "Hur nära som helst", "Inte inom 50 meter"], correct: 0, explain: "Du får inte stanna eller parkera på eller inom 10 meter före ett obevakat övergångsställe." },
  g_parkCross: { q: "Hur nära en korsning får du parkera?", options: ["Inte inom 10 meter från korsande körbanas närmaste ytterkant", "Inte inom 2 meter", "Det finns ingen regel", "Inte inom 50 meter"], correct: 0, explain: "Du får inte stanna eller parkera inom 10 meter från korsande körbanas närmaste ytterkant." },
  g_blind: { q: "Vad är döda vinkeln?", options: ["Ett område runt bilen som du inte ser i speglarna", "Vinkeln mellan två vägar i en korsning", "Området precis framför bilen", "Ett område där mobilen saknar täckning"], correct: 0, explain: "Vrid på huvudet och titta över axeln innan du byter körfält, svänger, kör ut eller parkerar." },
  g_eco: { q: "Vad är miljöanpassad körning?", options: ["Att accelerera mjukt, växla upp tidigt, planera och släppa gasen i god tid", "Att alltid köra så fort som möjligt", "Att köra på låg växel med högt varvtal", "Att låta motorn gå på tomgång medan du väntar"], correct: 0, explain: "Mjuk och förutseende körning sparar bränsle, minskar utsläppen och är säkrare." },
  g_reverse: { q: "Vad ska du göra när du backar?", options: ["Titta bakåt, köra långsamt och vara beredd att stanna", "Bara titta i backspegeln", "Tuta hela tiden", "Ha varningsblinkers på"], correct: 0, explain: "Du ansvarar för att backningen sker säkert. Vrid på huvudet och titta bakåt." },
  g_child: { q: "Hur ska ett barn som är kortare än 135 cm sitta i bilen?", options: ["I en bilbarnstol eller på en bälteskudde som passar barnets storlek", "Med vanligt bälte i framsätet", "I knät på en vuxen", "Utan bälte i baksätet"], correct: 0, explain: "Barn kortare än 135 cm ska använda särskild skyddsanordning anpassad efter barnets längd och vikt." },
  g_emergency: { q: "Ett utryckningsfordon närmar sig med blåljus och siren. Vad ska du göra?", options: ["Ge fri väg, kör åt sidan och stanna om det behövs", "Öka farten", "Fortsätta som vanligt", "Stanna mitt i körfältet"], correct: 0, explain: "Du ska ge fri väg åt utryckningsfordon." },
  g_fog: { q: "Det är tät dimma. Vad gäller för din hastighet?", options: ["Du ska anpassa farten efter sikten, även om skylten tillåter mer", "Du får alltid köra i hastighetsgränsen", "Du ska köra fortare för att komma ur dimman", "Hastighetsgränsen gäller inte i dimma"], correct: 0, explain: "Hastighetsgränsen är den högsta tillåtna farten. Du måste alltid anpassa farten efter väder, sikt och trafik." },
};
const GENERAL_IDS = Object.keys(QUIZ).filter((k) => k.startsWith("g_"));

const CONTROL_INFO: Record<Control, { title: string; rule: string }> = {
  none: { title: "Korsning utan skyltar", rule: "Högerregeln gäller: släpp fram fordon som kommer från höger." },
  yield: { title: "Väjningsplikt", rule: "Släpp fram trafik på korsande väg. Du behöver inte stanna om det är fritt." },
  stop: { title: "Stopplikt", rule: "Stanna helt vid stopplinjen, även om det är fritt, och släpp sedan fram korsande trafik." },
  main: { title: "Huvudled", rule: "Trafik från sidovägarna ska släppa fram dig. Vid vänstersväng släpper du ändå fram mötande." },
  light: { title: "Trafiksignal", rule: "Rött och gult betyder stopp. Vid vänstersväng på grönt släpper du fram mötande." },
  round: { title: "Cirkulationsplats", rule: "Väjningsplikt mot trafik i cirkulationen. Kör moturs och blinka höger innan du kör ut." },
  exit: { title: "Utfart från parkering", rule: "Utfartsregeln: du har väjningsplikt mot alla på vägen, även gående och cyklister." },
  infart: { title: "Infart till parkering", rule: "Blinka, sakta in och släpp fram gående på trottoaren. Vid vänstersväng släpper du fram mötande." },
  finish: { title: "", rule: "" },
};

/* ---------------- Grundmått och hjälpfunktioner ---------------- */
const B = 6;
const RB = 14;
const RC = 9.6;
const LANE = 1.75;
const STUB = 90;
const EYE_H = 1.15;
const HALF_CAR = 2.25;
const LX = -3000, LZ = 0;
const MR = { x: 0.52, y: 0.035, w: 0.26, h: 0.1 };
const ML = { x: 0.015, y: 0.54, w: 0.12, h: 0.1 };
const MRS = { x: 0.865, y: 0.54, w: 0.12, h: 0.1 };

const DIRS: V2[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const rightOf = (d: V2): V2 => [-d[1], d[0]];
const neg = (d: V2): V2 => [-d[0], -d[1]];
const eq = (a: V2, b: V2) => a[0] === b[0] && a[1] === b[1];
const isPerp = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1] === 0;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const maybe = (p: number) => Math.random() < p;
const shuffle = <T,>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const angleOf = (v: V2) => Math.atan2(-v[1], v[0]);
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const turnWord = (t: Turn) => (t === "right" ? "höger" : "vänster");

/* ---------------- Slumpad lektion ---------------- */
function generateCourse(lesson: Lesson): Leg[] {
  const legs: Leg[] = [];
  const side = (): 1 | -1 => (maybe(0.5) ? 1 : -1);
  const firstTurn: Turn = maybe(0.5) ? "left" : "right";
  legs.push({ len: 30, turn: firstTurn, control: "exit", cross: maybe(0.5) ? "left" : "right", items: [{ at: 21, kind: "walker", from: side() }], quizAfter: maybe(0.7) ? "utfart" : undefined });
  let heading: V2 = firstTurn === "right" ? [1, 0] : [-1, 0];
  const count = randInt(lesson.count[0], lesson.count[1]);
  const fill: Control[] = [];
  while (fill.length + lesson.must.length < count) fill.push(pick(lesson.pool));
  const bag = shuffle<Control>([...lesson.must, ...fill]);
  const general = shuffle(GENERAL_IDS);
  let gq = 0;
  let prevMainStraight = false;
  let railUsed = false;

  for (let k = 0; k < bag.length; k++) {
    const control = bag[k];
    const isN = heading[1] === -1;
    let len = isN ? randInt(230, 310) : randInt(170, 250);
    const turns: Turn[] = isN ? ["straight", "left", "right"] : heading[0] === 1 ? ["straight", "left"] : ["straight", "right"];
    let turn = pick(turns);
    if (turn === "straight" && maybe(0.4)) turn = pick(turns);
    if (lesson.rail === "force" && !railUsed && !isN) turn = heading[0] === 1 ? "left" : "right";
    if (lesson.rail === "force" && !railUsed && isN) len = Math.max(len, 300);
    const leg: Leg = { len, turn, control, items: [] };
    const used: number[] = [];
    const maxAt = len - (control === "round" ? 75 : 65);
    const isFree = (a: number, span = 0) => a >= 25 && a + span <= maxAt && used.every((u) => u < a - 40 || u > a + span + 40);
    const findSpot = (span = 0) => { for (let t = 0; t < 40; t++) { const a = rand(25, Math.max(26, maxAt - span)); if (isFree(a, span)) return a; } return -1; };
    const mark = (a: number, span = 0) => { used.push(a); if (span) used.push(a + span); };

    if (control === "main" && !prevMainStraight) { leg.items.push({ at: 20, kind: "sign", sign: "main", quiz: maybe(0.6) ? "main" : undefined }); used.push(20); }
    if (control !== "main" && prevMainStraight) { leg.items.push({ at: 20, kind: "sign", sign: "mainEnd", quiz: maybe(0.6) ? "mainEnd" : undefined }); used.push(20); }

    if (lesson.rail === "force" && !railUsed && isN) {
      const a = rand(140, maxAt);
      railUsed = true;
      leg.items.push({ at: a - 80, kind: "sign", sign: "railWarn", quiz: maybe(0.6) ? "railWarn" : undefined }, { at: a, kind: "rail", quiz: maybe(0.5) });
      mark(a - 80, 80);
    }

    const feats = shuffle(lesson.feats).slice(0, randInt(lesson.featCount[0], lesson.featCount[1]));
    for (const f of feats) {
      if (f === "crosswalk") { const a = findSpot(); if (a > 0) { leg.items.push({ at: a, kind: "crosswalk", from: side(), ped: maybe(lesson.ped), quiz: maybe(0.4) ? "crosswalk" : undefined }); mark(a); } }
      if (f === "school") {
        const a = findSpot(95);
        if (a > 0) {
          leg.items.push(
            { at: a, kind: "sign", sign: "children", quiz: maybe(0.5) ? "children" : undefined },
            { at: a + 10, kind: "speed", kmh: 30, quiz: maybe(0.4) ? "speed30" : undefined },
            { at: a + 50, kind: "crosswalk", from: side(), child: true, ped: true },
            { at: a + 95, kind: "speed", kmh: 50 }
          );
          mark(a, 95);
        }
      }
      if (f === "sign") { const a = findSpot(); if (a > 0) { const s: SignId = maybe(0.5) ? "noParking" : "noStopping"; leg.items.push({ at: a, kind: "sign", sign: s, quiz: maybe(0.6) ? s : undefined }); mark(a); } }
      if (f === "rail" && lesson.rail !== "never" && isN && !railUsed && len >= 260) {
        const a = findSpot();
        if (a > 110) { railUsed = true; leg.items.push({ at: a - 80, kind: "sign", sign: "railWarn", quiz: maybe(0.6) ? "railWarn" : undefined }, { at: a, kind: "rail", quiz: maybe(0.5) }); mark(a - 80, 80); }
      }
      if (f === "limit") {
        const a = findSpot(100);
        if (a > 0) {
          const kmh = pick<30 | 40>([30, 40]);
          leg.items.push({ at: a, kind: "speed", kmh, quiz: maybe(0.3) ? `speed${kmh}` : undefined }, { at: a + 100, kind: "speed", kmh: 50, quiz: maybe(0.3) ? "speed50" : undefined });
          mark(a, 100);
        }
      }
      if (f === "quiz" && gq < general.length) { const a = findSpot(); if (a > 0) { leg.items.push({ at: a, kind: "quiz", quiz: general[gq++] }); mark(a); } }
    }

    if (control === "none") { const r = Math.random(); if (r < 0.5) leg.cross = "right"; else if (r < 0.85) { leg.cross = "left"; leg.crossYields = true; } if (maybe(0.5)) leg.quizAfter = "rightRule"; }
    if (control === "yield" || control === "stop") { leg.cross = maybe(0.5) ? "left" : "right"; if (maybe(0.6)) leg.quizAfter = control; }
    if (control === "main") { leg.cross = maybe(0.5) ? "left" : "right"; leg.crossYields = true; }
    if (control === "light") { if (maybe(0.6)) leg.items.push({ at: len - 55, kind: "sign", sign: "lightWarn", quiz: maybe(0.3) ? "lightWarn" : undefined }); if (maybe(0.6)) leg.quizAfter = "yellow"; }
    if (control === "round") { leg.circ = maybe(0.8); if (maybe(0.7)) leg.quizAfter = pick(["roundExit", "roundYield", "roundabout"]); }
    if (turn === "left" && control !== "round") leg.oncoming = control === "light" || control === "main" ? true : maybe(0.5);
    if (turn === "right" && control !== "round") leg.cyclist = maybe(lesson.cyc);
    if (turn !== "straight" && control !== "round" && !leg.quizAfter && maybe(0.5)) leg.quizAfter = turn === "right" ? "rightTurn" : pick(["leftTurn", "leftTurnPrep"]);
    prevMainStraight = control === "main" && turn === "straight";
    legs.push(leg);
    heading = turn === "right" ? rightOf(heading) : turn === "left" ? neg(rightOf(heading)) : heading;
  }

  const isN = heading[1] === -1;
  const fturn: Turn = maybe(0.5) ? "right" : "left";
  const lastLeg: Leg = { len: isN ? randInt(230, 280) : randInt(170, 220), turn: fturn, control: "infart", oncoming: fturn === "left", items: [], quizAfter: maybe(0.7) ? "infart" : undefined };
  if (prevMainStraight) lastLeg.items.push({ at: 20, kind: "sign", sign: "mainEnd" });
  legs.push(lastLeg);
  legs.push({ len: 25, turn: "straight", control: "finish", items: [{ at: 9, kind: "walker", from: side() }] });
  return legs;
}

/* ---------------- Körväg ---------------- */
class LanePath {
  xs: number[] = [];
  zs: number[] = [];
  S: number[] = [];
  total = 0;
  add(x: number, z: number) {
    const n = this.xs.length;
    if (n) {
      const d = Math.hypot(x - this.xs[n - 1], z - this.zs[n - 1]);
      if (d < 1e-4) return;
      this.total += d;
    }
    this.xs.push(x); this.zs.push(z); this.S.push(this.total);
  }
  at(s: number) {
    const S = this.S, n = S.length;
    let i = 0, t = 0;
    if (s >= this.total) { i = n - 2; t = 1; }
    else if (s > 0) {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
      i = lo; t = (s - S[lo]) / (S[hi] - S[lo]);
    }
    const dx = this.xs[i + 1] - this.xs[i], dz = this.zs[i + 1] - this.zs[i];
    const l = Math.hypot(dx, dz) || 1;
    return { x: this.xs[i] + dx * t, z: this.zs[i] + dz * t, dx: dx / l, dz: dz / l };
  }
  closestS(x: number, z: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.xs.length; i++) { const d = Math.hypot(this.xs[i] - x, this.zs[i] - z); if (d < bd) { bd = d; best = this.S[i]; } }
    return best;
  }
}

function addRoundPath(p: LanePath, nx: number, nz: number, dIn: V2, dOut: V2) {
  const rIn = rightOf(dIn), rOut = rightOf(dOut);
  p.add(nx - dIn[0] * RB + rIn[0] * LANE, nz - dIn[1] * RB + rIn[1] * LANE);
  const a0 = angleOf(neg(dIn)) + 0.45;
  let a1 = angleOf(dOut) - 0.45;
  while (a1 <= a0 + 0.3) a1 += Math.PI * 2;
  const steps = Math.ceil((a1 - a0) / 0.1);
  for (let k = 0; k <= steps; k++) { const a = a0 + ((a1 - a0) * k) / steps; p.add(nx + RC * Math.cos(a), nz - RC * Math.sin(a)); }
  p.add(nx + dOut[0] * RB + rOut[0] * LANE, nz + dOut[1] * RB + rOut[1] * LANE);
  return [nx + RC * Math.cos(a0), nz - RC * Math.sin(a0)] as V2;
}

interface LegG { x0: number; z0: number; dir: V2; r: V2; len: number; nx: number; nz: number; out: V2; startLocal: number; endLocal: number; s0: number; Bn: number }
type Course = ReturnType<typeof buildCourse>;

function buildCourse(course: Leg[]) {
  const n = course.length;
  const Bn = (i: number) => (i < n - 1 ? (course[i].control === "round" ? RB : B) : 0);
  const legs: LegG[] = [];
  let x = 0, z = 0;
  let d: V2 = [0, -1];
  course.forEach((L, i) => {
    const r = rightOf(d);
    const out: V2 = L.turn === "right" ? r : L.turn === "left" ? neg(r) : d;
    const last = i === n - 1;
    legs.push({ x0: x, z0: z, dir: d, r, len: L.len, nx: x + d[0] * L.len, nz: z + d[1] * L.len, out, startLocal: i === 0 ? -40 : Bn(i - 1), endLocal: last ? L.len + 40 : L.len - Bn(i), s0: 0, Bn: Bn(i) });
    x += d[0] * L.len; z += d[1] * L.len; d = out;
  });
  const path = new LanePath();
  const boxIn: number[] = [], boxOut: number[] = [];
  const cp: V2[] = [];
  legs.forEach((g, i) => {
    g.s0 = path.total;
    for (let l = g.startLocal; l < g.endLocal; l += 2) path.add(g.x0 + g.dir[0] * l + g.r[0] * LANE, g.z0 + g.dir[1] * l + g.r[1] * LANE);
    path.add(g.x0 + g.dir[0] * g.endLocal + g.r[0] * LANE, g.z0 + g.dir[1] * g.endLocal + g.r[1] * LANE);
    if (i < n - 1) {
      boxIn[i] = path.total;
      if (course[i].control === "round") cp[i] = addRoundPath(path, g.nx, g.nz, g.dir, g.out);
      else {
        cp[i] = [g.nx, g.nz];
        const ro = rightOf(g.out);
        const p0x = g.nx - g.dir[0] * B + g.r[0] * LANE, p0z = g.nz - g.dir[1] * B + g.r[1] * LANE;
        const p2x = g.nx + g.out[0] * B + ro[0] * LANE, p2z = g.nz + g.out[1] * B + ro[1] * LANE;
        let p1x = (p0x + p2x) / 2, p1z = (p0z + p2z) / 2;
        if (!eq(g.out, g.dir)) { p1x = g.nx + g.r[0] * LANE + ro[0] * LANE; p1z = g.nz + g.r[1] * LANE + ro[1] * LANE; }
        for (let k = 1; k <= 16; k++) {
          const t = k / 16, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
          path.add(a * p0x + b * p1x + c * p2x, a * p0z + b * p1z + c * p2z);
        }
      }
      boxOut[i] = path.total;
    }
  });
  const sOf = (i: number, local: number) => legs[i].s0 + (local - legs[i].startLocal);
  return { legs, path, boxIn, boxOut, sOf, cp };
}

/* ---------------- Vägmärken ---------------- */
const ALL_SIGNS: SignId[] = ["yield", "stop", "main", "mainEnd", "crosswalk", "children", "railWarn", "railCross", "noParking", "noStopping", "lightWarn", "roundabout", "speed30", "speed40", "speed50"];

function drawSign(id: SignId): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const YELLOW = "#f6cf1a", RED = "#d21f1f", BLUE = "#1f5fae";
  const poly = (pts: number[][], fill: string) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fillStyle = fill; g.fill(); };
  const circle = (r: number, fill: string, x = 128, y = 128) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
  const warn = () => { poly([[128, 14], [246, 226], [10, 226]], RED); poly([[128, 58], [208, 204], [48, 204]], YELLOW); };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, col = "#111") => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  switch (id) {
    case "speed30": case "speed40": case "speed50":
      circle(124, RED); circle(96, YELLOW);
      g.fillStyle = "#111"; g.font = "bold 100px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(id.slice(5), 128, 136);
      break;
    case "yield": poly([[10, 30], [246, 30], [128, 240]], RED); poly([[58, 56], [198, 56], [128, 180]], YELLOW); break;
    case "stop": {
      const oct = (r: number) => Array.from({ length: 8 }, (_, k) => { const a = Math.PI / 8 + (k * Math.PI) / 4; return [128 + r * Math.cos(a), 128 + r * Math.sin(a)]; });
      poly(oct(126), "#fff"); poly(oct(114), "#c8102e");
      g.fillStyle = "#fff"; g.font = "bold 70px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("STOP", 128, 132);
      break;
    }
    case "main": case "mainEnd":
      poly([[128, 4], [252, 128], [128, 252], [4, 128]], "#9a9a9a");
      poly([[128, 10], [246, 128], [128, 246], [10, 128]], "#fff");
      poly([[128, 38], [218, 128], [128, 218], [38, 128]], YELLOW);
      if (id === "mainEnd") line(70, 186, 186, 70, 22);
      break;
    case "crosswalk":
      g.fillStyle = BLUE; g.fillRect(10, 10, 236, 236);
      poly([[128, 34], [226, 208], [30, 208]], "#fff");
      circle(13, "#111", 132, 96);
      line(130, 112, 122, 150, 12); line(122, 150, 104, 184, 10); line(122, 150, 146, 182, 10); line(128, 122, 152, 142, 9);
      g.fillStyle = "#111"; for (let k = 0; k < 5; k++) g.fillRect(70 + k * 24, 192, 14, 8);
      break;
    case "children":
      warn();
      circle(12, "#111", 106, 110); line(106, 124, 104, 160, 14); line(104, 160, 92, 190, 10); line(104, 160, 118, 190, 10);
      circle(10, "#111", 150, 128); line(150, 140, 150, 168, 12); line(150, 168, 140, 192, 9); line(150, 168, 160, 192, 9);
      line(112, 136, 144, 148, 8);
      break;
    case "railWarn":
      warn(); g.fillStyle = "#111";
      g.fillRect(80, 118, 10, 76); g.fillRect(166, 118, 10, 76); g.fillRect(74, 132, 108, 12); g.fillRect(74, 164, 108, 12);
      break;
    case "railCross":
      for (const a of [0.62, -0.62]) { g.save(); g.translate(128, 128); g.rotate(a); g.fillStyle = RED; g.fillRect(-124, -22, 248, 44); g.fillStyle = "#fff"; g.fillRect(-116, -14, 232, 28); g.restore(); }
      break;
    case "noParking":
      circle(124, RED); circle(98, BLUE);
      g.save(); g.beginPath(); g.arc(128, 128, 98, 0, Math.PI * 2); g.clip(); line(40, 40, 216, 216, 26, RED); g.restore();
      break;
    case "noStopping":
      circle(124, RED); circle(98, BLUE);
      g.save(); g.beginPath(); g.arc(128, 128, 98, 0, Math.PI * 2); g.clip(); line(40, 40, 216, 216, 26, RED); line(216, 40, 40, 216, 26, RED); g.restore();
      break;
    case "lightWarn":
      warn(); g.fillStyle = "#111"; g.fillRect(108, 96, 40, 100);
      circle(11, "#e02020", 128, 114); circle(11, "#f6c21a", 128, 146); circle(11, "#20b050", 128, 178);
      break;
    case "roundabout":
      circle(124, BLUE);
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 3 + 0.5;
        const e = a - 1.3;
        g.strokeStyle = "#fff"; g.lineWidth = 18; g.lineCap = "butt";
        g.beginPath(); g.arc(128, 128, 64, a, e, true); g.stroke();
        const ex = 128 + 64 * Math.cos(e), ey = 128 + 64 * Math.sin(e);
        const tx = Math.sin(e), ty = -Math.cos(e), nx = Math.cos(e), ny = Math.sin(e);
        poly([[ex + tx * 26, ey + ty * 26], [ex + nx * 20, ey + ny * 20], [ex - nx * 20, ey - ny * 20]], "#fff");
      }
      break;
  }
  return c;
}

const texCache = new Map<SignId, THREE.Texture>();
function texFor(id: SignId) {
  let t = texCache.get(id);
  if (!t) { t = new THREE.CanvasTexture(drawSign(id)); t.colorSpace = THREE.SRGBColorSpace; texCache.set(id, t); }
  return t;
}

const POLE_MAT = new THREE.MeshLambertMaterial({ color: 0x8f959b });

function placeSign(group: THREE.Group, id: SignId, cx: number, cz: number, travel: V2, lat = 4.3, faceY = 2.2) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, faceY + 0.3, 8), POLE_MAT);
  pole.position.y = (faceY + 0.3) / 2;
  g.add(pole);
  const size = id === "railCross" ? 1.25 : 0.8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: texFor(id), alphaTest: 0.5 }));
  face.position.set(0, faceY, 0.05);
  g.add(face);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: texFor(id), color: 0x3a3a3a, alphaTest: 0.5 }));
  back.position.set(0, faceY, 0.03);
  back.rotation.y = Math.PI;
  g.add(back);
  const r = rightOf(travel);
  g.position.set(cx + r[0] * lat, 0, cz + r[1] * lat);
  g.rotation.y = Math.atan2(-travel[0], -travel[1]);
  group.add(g);
}

/* ---------------- Fordon, människor, cyklister ---------------- */
const WHEEL_GEO = new THREE.CylinderGeometry(1, 1, 1, 16);
WHEEL_GEO.rotateZ(Math.PI / 2);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x151515 });
const CAR_COLORS = [0xe8e8e8, 0x1c1c1c, 0x6b6f75, 0xb0b4b8, 0x1f3a5f, 0x8e1b1b, 0x2d4a3e];

const bx = (w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m);
  mesh.position.set(x, y, z);
  return mesh;
};

function makeCar(color: number) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2530 });
  g.add(bx(1.8, 0.62, 4.4, body, 0, 0.6, 0));
  g.add(bx(1.62, 0.5, 2.2, glass, 0, 1.15, -0.25));
  g.add(bx(1.64, 0.07, 1.9, body, 0, 1.42, -0.3));
  for (const x of [-0.86, 0.86]) for (const z of [-1.35, 1.35]) {
    const w = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
    w.scale.set(0.24, 0.33, 0.33); w.position.set(x, 0.33, z); g.add(w);
  }
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xa01018 });
  g.add(bx(0.34, 0.14, 0.05, hl, -0.58, 0.68, 2.21), bx(0.34, 0.14, 0.05, hl, 0.58, 0.68, 2.21));
  g.add(bx(0.36, 0.14, 0.05, tl, -0.6, 0.72, -2.21), bx(0.36, 0.14, 0.05, tl, 0.6, 0.72, -2.21));
  return { obj: g, len: 4.4 };
}

function makePerson(child: boolean) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: pick([0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad]) });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0b899 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.65, 10), shirt);
  body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin);
  head.position.y = 1.62;
  g.add(body, head);
  const legGeo = new THREE.BoxGeometry(0.13, 0.8, 0.15);
  legGeo.translate(0, -0.4, 0);
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.1, 0.1]) { const l = new THREE.Mesh(legGeo, pants); l.position.set(x, 0.82, 0); g.add(l); legs.push(l); }
  g.scale.setScalar(child ? 0.68 : 1);
  return { obj: g, legs };
}

function makeCyclist() {
  const g = new THREE.Group();
  const black = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const frame = new THREE.MeshLambertMaterial({ color: pick([0xd35400, 0x2980b9, 0x16a085]) });
  for (const z of [-0.55, 0.55]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 20), black);
    w.rotation.y = Math.PI / 2; w.position.set(0, 0.36, z); g.add(w);
  }
  g.add(bx(0.06, 0.06, 1.1, frame, 0, 0.62, 0));
  g.add(bx(0.06, 0.5, 0.06, frame, 0, 0.6, -0.2));
  const jacket = new THREE.MeshLambertMaterial({ color: pick([0xf1c40f, 0xe74c3c, 0x3498db]) });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.6, 8), jacket);
  body.position.set(0, 1.2, -0.05); body.rotation.x = 0.35; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  head.position.set(0, 1.62, 0.12); g.add(head);
  return g;
}

function buildHood() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.55, -0.52, -1.35, 1.25, -0.52, -1.35, -0.55, -0.66, -3.05, 1.25, -0.66, -3.05, -0.55, -0.82, -3.12, 1.25, -0.82, -3.12,
  ], 3));
  geo.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x1f3b6e, shininess: 80, specular: 0x555555, side: THREE.DoubleSide }));
}

/* ---------------- Staden ---------------- */
interface Rect { x0: number; x1: number; z0: number; z1: number }
const along = (x: number, z: number, d: V2, l0: number, l1: number, w: number): Rect => {
  const ax = x + d[0] * l0, az = z + d[1] * l0, bx2 = x + d[0] * l1, bz = z + d[1] * l1;
  const hx = d[0] === 0 ? w : 0, hz = d[1] === 0 ? w : 0;
  return { x0: Math.min(ax, bx2) - hx, x1: Math.max(ax, bx2) + hx, z0: Math.min(az, bz) - hz, z1: Math.max(az, bz) + hz };
};
const overlap = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

function localRect(arr: number[], x: number, z: number, dir: V2, l0: number, l1: number, t0: number, t1: number, y = 0.015) {
  const r = rightOf(dir);
  const P = (l: number, t: number) => [x + dir[0] * l + r[0] * t, z + dir[1] * l + r[1] * t];
  const a = P(l0, t0), b = P(l1, t0), c = P(l1, t1), d = P(l0, t1);
  arr.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
}
function localTri(arr: number[], x: number, z: number, dir: V2, pts: [number, number][], y = 0.015) {
  const r = rightOf(dir);
  for (const [l, t] of pts) arr.push(x + dir[0] * l + r[0] * t, y, z + dir[1] * l + r[1] * t);
}
const markMat = () => new THREE.MeshLambertMaterial({ color: 0xeeeeee, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

type LightMats = { red: THREE.MeshBasicMaterial; yellow: THREE.MeshBasicMaterial; green: THREE.MeshBasicMaterial };
type RailParts = { i: number; at: number; cx: number; cz: number; r: V2; arms: THREE.Group[]; lamps: THREE.MeshBasicMaterial[]; train: THREE.Group };

function buildTown(group: THREE.Group, course: Leg[], C: Course) {
  const legs = C.legs;
  const last = legs.length - 1;
  const lines: { x: number; z: number; dir: V2; l0: number; l1: number }[] = [];
  const boxes: Rect[] = [];
  legs.forEach((g) => lines.push({ x: g.x0, z: g.z0, dir: g.dir, l0: g.startLocal, l1: g.endLocal }));
  legs.forEach((g, i) => {
    if (i === last) return;
    boxes.push({ x0: g.nx - g.Bn, x1: g.nx + g.Bn, z0: g.nz - g.Bn, z1: g.nz + g.Bn });
    for (const a of DIRS) {
      if (eq(a, neg(g.dir)) || eq(a, g.out)) continue;
      lines.push({ x: g.nx, z: g.nz, dir: a, l0: g.Bn, l1: STUB });
    }
  });
  const roadRects = lines.map((l) => along(l.x, l.z, l.dir, l.l0, l.l1, 3.5));

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x6d8a44 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -1000);
  group.add(ground);

  const asph = new THREE.MeshLambertMaterial({ color: 0x4a4c50 });
  const addPlane = (r: Rect, y = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), asph);
    m.rotation.x = -Math.PI / 2; m.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2); group.add(m);
  };
  roadRects.forEach((r) => addPlane(r));
  legs.forEach((g, i) => {
    if (i === last) return;
    if (course[i].control === "round") {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(RB + 0.6, 48), asph);
      disc.rotation.x = -Math.PI / 2; disc.position.set(g.nx, 0.004, g.nz); group.add(disc);
      const curb = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.16, 40), new THREE.MeshLambertMaterial({ color: 0xb0aca4 }));
      curb.position.set(g.nx, 0.08, g.nz); group.add(curb);
      const island = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.22, 40), new THREE.MeshLambertMaterial({ color: 0x5d8a3a }));
      island.position.set(g.nx, 0.11, g.nz); group.add(island);
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 2.5, 6), new THREE.MeshLambertMaterial({ color: 0x5a4632 }));
      tr.position.set(g.nx, 1.3, g.nz); group.add(tr);
      const cr = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f6b2e }));
      cr.position.set(g.nx, 3.6, g.nz); group.add(cr);
    } else addPlane(boxes[i]);
  });

  const walkMat = new THREE.MeshLambertMaterial({ color: 0xa9a59c });
  for (const l of lines) for (const side of [-1, 1]) {
    const r = rightOf(l.dir);
    const rc = along(l.x + r[0] * side * 5, l.z + r[1] * side * 5, l.dir, l.l0, l.l1, 1.5);
    const m = new THREE.Mesh(new THREE.BoxGeometry(rc.x1 - rc.x0, 0.14, rc.z1 - rc.z0), walkMat);
    m.position.set((rc.x0 + rc.x1) / 2, 0.07, (rc.z0 + rc.z1) / 2);
    group.add(m);
  }

  const mk: number[] = [];
  for (const l of lines) for (let s = l.l0 + 2; s + 3 <= l.l1 - 2; s += 12) localRect(mk, l.x, l.z, l.dir, s, s + 3, -0.06, 0.06);
  const yieldTeeth = (x: number, z: number, a: V2, from: number) => {
    for (let t = 0.3; t < 3.3; t += 0.6) localTri(mk, x, z, a, [[from + 0.9, -t], [from + 0.9, -t - 0.45], [from + 1.7, -t - 0.225]]);
  };
  legs.forEach((g, i) => {
    if (i === last) return;
    const L = course[i];
    const sl = g.len - g.Bn;
    const pt = (local: number) => [g.x0 + g.dir[0] * local, g.z0 + g.dir[1] * local];
    if (L.control === "stop" || L.control === "light") localRect(mk, g.x0, g.z0, g.dir, sl - 1.5, sl - 1.0, 0, 3.4);
    if (L.control === "yield") for (let t = 0.3; t < 3.3; t += 0.6) localTri(mk, g.x0, g.z0, g.dir, [[sl - 0.9, t], [sl - 0.9, t + 0.45], [sl - 1.7, t + 0.225]]);
    if (L.control === "main") for (const a of DIRS) {
      if (!isPerp(a, g.dir)) continue;
      yieldTeeth(g.nx, g.nz, a, B);
      placeSign(group, "yield", g.nx + a[0] * (B + 2.5), g.nz + a[1] * (B + 2.5), neg(a));
    }
    if (L.control === "round") for (const a of DIRS) {
      yieldTeeth(g.nx, g.nz, a, RB);
      placeSign(group, "yield", g.nx + a[0] * (RB + 3), g.nz + a[1] * (RB + 3), neg(a), 4.3, 2.2);
      placeSign(group, "roundabout", g.nx + a[0] * (RB + 3), g.nz + a[1] * (RB + 3), neg(a), 4.3, 3.05);
    }
    if (L.control === "yield") { const p = pt(sl - 2.5); placeSign(group, "yield", p[0], p[1], g.dir); }
    if (L.control === "stop") { const p = pt(sl - 2.5); placeSign(group, "stop", p[0], p[1], g.dir); }
  });

  course.forEach((L, i) => {
    const g = legs[i];
    const pt = (local: number) => [g.x0 + g.dir[0] * local, g.z0 + g.dir[1] * local];
    for (const it of L.items) {
      if (it.kind === "speed") { const p = pt(it.at); placeSign(group, `speed${it.kmh}` as SignId, p[0], p[1], g.dir); }
      if (it.kind === "sign") { const p = pt(it.at); placeSign(group, it.sign, p[0], p[1], g.dir); }
      if (it.kind === "crosswalk") {
        for (let t = -3.25; t < 3.3; t += 1) localRect(mk, g.x0, g.z0, g.dir, it.at - 1.5, it.at + 1.5, t, t + 0.5);
        const a = pt(it.at - 2), b2 = pt(it.at + 2);
        placeSign(group, "crosswalk", a[0], a[1], g.dir);
        placeSign(group, "crosswalk", b2[0], b2[1], neg(g.dir));
      }
      if (it.kind === "rail") {
        localRect(mk, g.x0, g.z0, g.dir, it.at - 7.5, it.at - 7.0, 0, 3.4);
        localRect(mk, g.x0, g.z0, g.dir, it.at + 7.0, it.at + 7.5, -3.4, 0);
      }
    }
  });
  const mkGeo = new THREE.BufferGeometry();
  mkGeo.setAttribute("position", new THREE.Float32BufferAttribute(mk, 3));
  mkGeo.computeVertexNormals();
  group.add(new THREE.Mesh(mkGeo, markMat()));

  const lights: Record<number, LightMats> = {};
  course.forEach((L, i) => {
    if (L.control !== "light") return;
    const g = legs[i];
    const local = g.len - B - 2.5;
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 8), POLE_MAT);
    pole.position.y = 1.65; grp.add(pole);
    grp.add(bx(0.36, 1.05, 0.3, new THREE.MeshLambertMaterial({ color: 0x1a1a1a }), 0, 2.95, 0));
    const red = new THREE.MeshBasicMaterial({ color: 0x330000 });
    const yellow = new THREE.MeshBasicMaterial({ color: 0x332800 });
    const green = new THREE.MeshBasicMaterial({ color: 0x003311 });
    ([[red, 3.28], [yellow, 2.95], [green, 2.62]] as [THREE.Material, number][]).forEach(([m, y]) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m);
      s.position.set(0, y, 0.16); grp.add(s);
    });
    grp.position.set(g.x0 + g.dir[0] * local + g.r[0] * 4.3, 0, g.z0 + g.dir[1] * local + g.r[1] * 4.3);
    grp.rotation.y = Math.atan2(-g.dir[0], -g.dir[1]);
    group.add(grp);
    lights[i] = { red, yellow, green };
  });

  let rail: RailParts | null = null;
  const railRects: Rect[] = [];
  course.forEach((L, i) => {
    for (const it of L.items) {
      if (it.kind !== "rail") continue;
      const g = legs[i];
      const cx = g.x0 + g.dir[0] * it.at, cz = g.z0 + g.dir[1] * it.at;
      const r = g.r;
      railRects.push(along(cx, cz, r, -150, 150, 3));
      const bed = new THREE.MeshLambertMaterial({ color: 0x7a6e60 });
      for (const [a, b2] of [[4, 150], [-150, -4]]) {
        const rc = along(cx, cz, r, a, b2, 1.6);
        const m = new THREE.Mesh(new THREE.BoxGeometry(rc.x1 - rc.x0, 0.1, rc.z1 - rc.z0), bed);
        m.position.set((rc.x0 + rc.x1) / 2, 0.03, (rc.z0 + rc.z1) / 2); group.add(m);
      }
      const steel = new THREE.MeshLambertMaterial({ color: 0x80858b });
      for (const off of [-0.72, 0.72]) {
        const rc = along(cx + g.dir[0] * off, cz + g.dir[1] * off, r, -150, 150, 0.035);
        const m = new THREE.Mesh(new THREE.BoxGeometry(rc.x1 - rc.x0, 0.12, rc.z1 - rc.z0), steel);
        m.position.set((rc.x0 + rc.x1) / 2, 0.1, (rc.z0 + rc.z1) / 2); group.add(m);
      }
      const sleepers: THREE.Matrix4[] = [];
      for (let k = -150; k <= 150; k += 0.8) {
        if (Math.abs(k) < 3.6) continue;
        const sx = r[0] !== 0 ? 0.25 : 2.4, sz = r[0] !== 0 ? 2.4 : 0.25;
        sleepers.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + r[0] * k, 0.08, cz + r[1] * k), new THREE.Quaternion(), new THREE.Vector3(sx, 0.08, sz)));
      }
      const sm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x4a3c30 }), sleepers.length);
      sleepers.forEach((m, k) => sm.setMatrixAt(k, m));
      group.add(sm);
      const p1 = [g.x0 + g.dir[0] * (it.at - 4), g.z0 + g.dir[1] * (it.at - 4)];
      const p2 = [g.x0 + g.dir[0] * (it.at + 4), g.z0 + g.dir[1] * (it.at + 4)];
      placeSign(group, "railCross", p1[0], p1[1], g.dir, 4.6);
      placeSign(group, "railCross", p2[0], p2[1], neg(g.dir), 4.6);

      const stripe = document.createElement("canvas");
      stripe.width = 64; stripe.height = 8;
      const sg = stripe.getContext("2d")!;
      for (let k = 0; k < 4; k++) { sg.fillStyle = k % 2 ? "#ffffff" : "#d21f1f"; sg.fillRect(k * 16, 0, 16, 8); }
      const stex = new THREE.CanvasTexture(stripe);
      stex.colorSpace = THREE.SRGBColorSpace; stex.wrapS = stex.wrapT = THREE.RepeatWrapping; stex.repeat.set(3, 1);
      const armMat = new THREE.MeshLambertMaterial({ map: stex });
      const armGeo = new THREE.BoxGeometry(0.1, 0.1, 4.4);
      armGeo.translate(0, 0, 2.2);
      const arms: THREE.Group[] = [];
      const lamps: THREE.MeshBasicMaterial[] = [];
      const makeBarrier = (local: number, lat: number, toward: V2, travel: V2) => {
        const px = g.x0 + g.dir[0] * local + g.r[0] * lat, pz = g.z0 + g.dir[1] * local + g.r[1] * lat;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8), POLE_MAT);
        post.position.set(px, 0.95, pz); group.add(post);
        const pivot = new THREE.Group();
        pivot.position.set(px, 1.05, pz);
        pivot.rotation.y = Math.atan2(toward[0], toward[1]);
        const holder = new THREE.Group();
        holder.add(new THREE.Mesh(armGeo, armMat));
        holder.rotation.x = -Math.PI / 2;
        pivot.add(holder); group.add(pivot); arms.push(holder);
        const lh = new THREE.Group();
        lh.position.set(px, 1.75, pz);
        lh.rotation.y = Math.atan2(-travel[0], -travel[1]);
        for (const x of [-0.22, 0.22]) {
          const m = new THREE.MeshBasicMaterial({ color: 0x330000 });
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m);
          s.position.set(x, 0, 0.1); lh.add(s); lamps.push(m);
        }
        group.add(lh);
      };
      makeBarrier(it.at - 5.5, 4.3, neg(g.r), g.dir);
      makeBarrier(it.at + 5.5, -4.3, g.r, neg(g.dir));
      const train = new THREE.Group();
      const tMat = new THREE.MeshLambertMaterial({ color: 0x34495e });
      const tStripe = new THREE.MeshLambertMaterial({ color: 0xc0392b });
      for (let k = 0; k < 3; k++) { const zc = -9.2 - k * 18.4; train.add(bx(3, 3.6, 18, tMat, 0, 2.2, zc)); train.add(bx(3.02, 0.3, 18, tStripe, 0, 1.6, zc)); }
      train.rotation.y = Math.atan2(r[0], r[1]);
      train.position.set(cx - r[0] * 600, 0, cz - r[1] * 600);
      group.add(train);
      rail = { i, at: it.at, cx, cz, r, arms, lamps, train };
    }
  });

  const blockRects = [...roadRects, ...boxes, ...railRects];
  const winC = document.createElement("canvas");
  winC.width = winC.height = 64;
  const wg = winC.getContext("2d")!;
  wg.fillStyle = "#fff"; wg.fillRect(0, 0, 64, 64); wg.fillStyle = "#e9e9e9"; wg.fillRect(14, 12, 36, 42); wg.fillStyle = "#3a4654"; wg.fillRect(17, 15, 30, 36);
  const winTex = new THREE.CanvasTexture(winC);
  winTex.colorSpace = THREE.SRGBColorSpace; winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
  const palette = [0xe8d9a8, 0xd8cfc0, 0xb5543c, 0x8c1c13, 0xf0ece4, 0x9fb3a6, 0xd7a86e, 0xc9c3b6];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  const placed: Rect[] = [];
  const lamps: THREE.Matrix4[] = [];
  const trees: THREE.Vector3[] = [];
  const q = new THREE.Quaternion();
  for (const l of lines) {
    const r = rightOf(l.dir);
    for (const side of [-1, 1]) {
      for (let s = l.l0 + 5; s < l.l1 - 5; s += 30) {
        lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x + l.dir[0] * s + r[0] * side * 6.1, 3, l.z + l.dir[1] * s + r[1] * side * 6.1), q, new THREE.Vector3(1, 1, 1)));
        if (maybe(0.5)) trees.push(new THREE.Vector3(l.x + l.dir[0] * (s + 15) + r[0] * side * 7.6, rand(0.8, 1.3), l.z + l.dir[1] * (s + 15) + r[1] * side * 7.6));
      }
      let s = l.l0 + 2;
      while (s < l.l1 - 8) {
        const w = rand(9, 20), dpt = rand(8, 14), h = pick([4, 6, 7, 9, 12, 15]);
        const lat = side * (rand(9, 11.5) + dpt / 2);
        const cx = l.x + l.dir[0] * (s + w / 2) + r[0] * lat, cz = l.z + l.dir[1] * (s + w / 2) + r[1] * lat;
        const sx = l.dir[0] !== 0 ? w : dpt, sz = l.dir[0] !== 0 ? dpt : w;
        const rect = { x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2 };
        if (!blockRects.some((b2) => overlap(rect, b2, 5)) && !placed.some((b2) => overlap(rect, b2, 1))) {
          placed.push(rect);
          const t = winTex.clone();
          t.needsUpdate = true;
          t.repeat.set(Math.max(1, Math.round(w / 3.5)), Math.max(1, Math.round(h / 3)));
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), new THREE.MeshLambertMaterial({ color: pick(palette), map: t }));
          m.position.set(cx, h / 2, cz); group.add(m);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.3, 0.4, sz + 0.3), roofMat);
          roof.position.set(cx, h + 0.2, cz); group.add(roof);
        }
        s += w + rand(1, 6);
      }
    }
  }
  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 6), POLE_MAT, lamps.length);
  lamps.forEach((m, i) => lampPole.setMatrixAt(i, m));
  group.add(lampPole);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x5a4632 }), trees.length);
  const crown = new THREE.InstancedMesh(new THREE.SphereGeometry(1.9, 10, 8), new THREE.MeshLambertMaterial({ color: 0x3f6b2e }), trees.length);
  const tmp = new THREE.Matrix4();
  trees.forEach((p, i) => {
    trunk.setMatrixAt(i, tmp.compose(new THREE.Vector3(p.x, 1.3, p.z), q, new THREE.Vector3(1, 1, 1)));
    crown.setMatrixAt(i, tmp.compose(new THREE.Vector3(p.x, 3.6 * p.y, p.z), q, new THREE.Vector3(1, p.y, 1)));
  });
  group.add(trunk, crown);

  return { lights, rail: rail as RailParts | null };
}

/* ---------------- Parkering och manövrering ---------------- */
type OBB = { x: number; z: number; yaw: number; hx: number; hz: number; kind: "car" | "curb" };
interface Lot {
  task: Task;
  start: { x: number; z: number; yaw: number };
  obstacles: OBB[];
  bay?: { x0: number; x1: number; z0: number; z1: number; yaw: number };
  gap?: { xMin: number; xMax: number; curbZ: number; yaw: number };
  segs: number[][];
  center: V2;
}

const obbAxes = (o: { yaw: number }) => [[Math.cos(o.yaw), -Math.sin(o.yaw)], [-Math.sin(o.yaw), -Math.cos(o.yaw)]];
function obbHit(a: { x: number; z: number; yaw: number; hx: number; hz: number }, b: { x: number; z: number; yaw: number; hx: number; hz: number }) {
  const A = obbAxes(a), Bb = obbAxes(b);
  for (const n of [...A, ...Bb]) {
    const proj = (o: typeof a, O: number[][]) => ({ c: o.x * n[0] + o.z * n[1], r: o.hx * Math.abs(O[0][0] * n[0] + O[0][1] * n[1]) + o.hz * Math.abs(O[1][0] * n[0] + O[1][1] * n[1]) });
    const pa = proj(a, A), pb = proj(b, Bb);
    if (Math.abs(pa.c - pb.c) > pa.r + pb.r) return false;
  }
  return true;
}
const obbCorners = (o: { x: number; z: number; yaw: number; hx: number; hz: number }) => {
  const [R, F] = obbAxes(o);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b2]) => [o.x + R[0] * o.hx * a + F[0] * o.hz * b2, o.z + R[1] * o.hx * a + F[1] * o.hz * b2]);
};

function buildLot(group: THREE.Group, task: Task): Lot {
  const obstacles: OBB[] = [];
  const segs: number[][] = [];
  const mk: number[] = [];
  const asph = new THREE.MeshLambertMaterial({ color: 0x4a4c50 });
  const walk = new THREE.MeshLambertMaterial({ color: 0xa9a59c });
  const X = LX, Z = LZ;
  const plane = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, y = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); group.add(m);
  };
  const curbBox = (x0: number, x1: number, z0: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.15, z1 - z0), walk);
    m.position.set((x0 + x1) / 2, 0.075, (z0 + z1) / 2); group.add(m);
    obstacles.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, yaw: 0, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, kind: "curb" });
    segs.push([x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
  };
  const line = (x1: number, z1: number, x2: number, z2: number, w = 0.1) => {
    segs.push([x1, z1, x2, z2]);
    if (x1 === x2) mk.push(x1 - w / 2, 0.012, z1, x1 + w / 2, 0.012, z1, x1 + w / 2, 0.012, z2, x1 - w / 2, 0.012, z1, x1 + w / 2, 0.012, z2, x1 - w / 2, 0.012, z2);
    else mk.push(x1, 0.012, z1 - w / 2, x2, 0.012, z1 - w / 2, x2, 0.012, z1 + w / 2, x1, 0.012, z1 - w / 2, x2, 0.012, z1 + w / 2, x1, 0.012, z1 + w / 2);
  };
  const parked = (x: number, z: number, yaw: number) => {
    const m = makeCar(pick(CAR_COLORS));
    m.obj.position.set(x, 0, z); m.obj.rotation.y = yaw + Math.PI; group.add(m.obj);
    obstacles.push({ x, z, yaw, hx: 0.92, hz: 2.22, kind: "car" });
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x6d8a44 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(X, -0.05, Z); group.add(ground);
  plane(X - 46, X + 46, Z - 16, Z + 16, asph);
  const hl = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, depthWrite: false });

  let lot: Lot;
  if (task !== "parallel") {
    curbBox(X - 46, X + 46, Z - 12, Z - 9); curbBox(X - 46, X + 46, Z + 9, Z + 12);
    curbBox(X - 48, X - 46, Z - 9, Z + 9); curbBox(X + 46, X + 48, Z - 9, Z + 9);
    for (let i = -8; i <= 9; i++) { const x = X + (i - 0.5) * 2.7; line(x, Z - 8.7, x, Z - 3.5); line(x, Z + 3.5, x, Z + 8.7); }
    const t = randInt(-3, 3);
    for (let i = -8; i <= 8; i++) {
      if (i !== t && (Math.abs(i - t) === 1 || maybe(0.55))) parked(X + i * 2.7 + rand(-0.12, 0.12), Z - 6.1, maybe(0.5) ? 0 : Math.PI);
      if (maybe(0.5)) parked(X + i * 2.7 + rand(-0.12, 0.12), Z + 6.1, maybe(0.5) ? 0 : Math.PI);
    }
    const bay = { x0: X + t * 2.7 - 1.3, x1: X + t * 2.7 + 1.3, z0: Z - 8.7, z1: Z - 3.5, yaw: task === "back" ? Math.PI : 0 };
    plane(bay.x0, bay.x1, bay.z0, bay.z1, hl, 0.02);
    lot = {
      task, obstacles, segs, bay,
      start: task === "back" ? { x: X + t * 2.7 + 6.5, z: Z + 1.0, yaw: Math.PI / 2 } : { x: X + t * 2.7 + 15, z: Z + 1.5, yaw: Math.PI / 2 },
      center: [X + t * 2.7, Z - 3],
    };
  } else {
    const curbZ = Z - 4;
    curbBox(X - 46, X + 46, Z - 7, curbZ); curbBox(X - 46, X + 46, Z + 8, Z + 11);
    curbBox(X - 48, X - 46, curbZ, Z + 8); curbBox(X + 46, X + 48, curbZ, Z + 8);
    for (let x = X - 44; x < X + 44; x += 6) line(x, Z + 2, x + 3, Z + 2, 0.12);
    const gl = rand(6.8, 7.6), gx = X + rand(-4, 4);
    const ax = gx - gl / 2 - 2.22, bxx = gx + gl / 2 + 2.22, cz = curbZ + 1.05;
    parked(ax, cz, Math.PI / 2); parked(bxx, cz, Math.PI / 2);
    if (maybe(0.7)) parked(ax - 6.8, cz, Math.PI / 2);
    if (maybe(0.7)) parked(bxx + 6.8, cz, Math.PI / 2);
    const gap = { xMin: ax + 2.22, xMax: bxx - 2.22, curbZ, yaw: Math.PI / 2 };
    plane(gap.xMin, gap.xMax, curbZ, curbZ + 2, hl, 0.02);
    lot = { task, obstacles, segs, gap, start: { x: bxx + 14, z: curbZ + 3.7, yaw: Math.PI / 2 }, center: [gx, curbZ + 2] };
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(mk, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, markMat()));
  for (let k = 0; k < 6; k++) {
    const h = pick([6, 9, 12]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(14, h, 10), new THREE.MeshLambertMaterial({ color: pick([0xe8d9a8, 0xb5543c, 0xf0ece4]) }));
    m.position.set(X - 40 + k * 16, h / 2, Z - 22);
    group.add(m);
  }
  return lot;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (m.geometry !== WHEEL_GEO) m.geometry.dispose();
      const mat = m.material as THREE.Material;
      if (mat !== WHEEL_MAT && mat !== POLE_MAT) mat.dispose();
    }
  });
  g.clear();
}

/* =========================================================
   Sidan
   ========================================================= */
type MsgKind = "info" | "good" | "bad" | "eco";
type Phase = "start" | "running" | "crashed" | "finished";
type Keys = { up: boolean; down: boolean; left: boolean; right: boolean; lookL: boolean; lookR: boolean; back: boolean };
type Panel = { title: string; rule: string; checks: { t: string; ok: boolean | null }[]; extra: string[] } | null;
type Summary = { lesson: string; cond: string; reason: string; faults: string[]; eco: string[]; right: number; total: number; maneuver: string };

interface Car {
  path: LanePath; s: number; v: number; vWant: number; len: number;
  role: "priority" | "yield" | "ambient"; kind: "cross" | "oncoming" | "circ" | "ambient";
  node: number; boxIn: number; obj: THREE.Group;
}

export default function Index() {
  const mountRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<SVGGElement>(null);
  const speedRef = useRef<SVGTextElement>(null);
  const wheelRef = useRef<SVGGElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const blinkLRef = useRef<SVGSVGElement>(null);
  const blinkRRef = useRef<SVGSVGElement>(null);
  const btnLRef = useRef<HTMLButtonElement>(null);
  const btnRRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const navTextRef = useRef<HTMLSpanElement>(null);
  const navArrowRef = useRef<SVGSVGElement>(null);
  const dashRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const keys = useRef<Keys>({ up: false, down: false, left: false, right: false, lookL: false, lookR: false, back: false });
  const api = useRef<{ start: (id: string) => void; blink: (d: "left" | "right") => void; resume: (ok: boolean) => void; gear: () => void; quit: () => void } | null>(null);
  const settings = useRef({ voice: true, quiz: true, help: true });

  const [phase, setPhase] = useState<Phase>("start");
  const [mode, setMode] = useState<"town" | "maneuver">("town");
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind; id: number } | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lessonId, setLessonId] = useState("mixed");
  const [running, setRunning] = useState<{ title: string; cond: string } | null>(null);
  const [voice, setVoice] = useState(true);
  const [quizOn, setQuizOn] = useState(true);
  const [help, setHelp] = useState(true);
  const [touch, setTouch] = useState(false);

  const signImages = useMemo(() => {
    if (typeof document === "undefined") return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const id of ALL_SIGNS) out[id] = drawSign(id).toDataURL();
    return out;
  }, []);

  useEffect(() => { settings.current.voice = voice; }, [voice]);
  useEffect(() => { settings.current.quiz = quizOn; }, [quizOn]);
  useEffect(() => { settings.current.help = help; }, [help]);
  useEffect(() => { setTouch(window.matchMedia("(pointer: coarse)").matches); }, []);
  useEffect(() => {
    if (!msg) return;
    const id = msg.id;
    const t = setTimeout(() => setMsg((m) => (m && m.id === id ? null : m)), 5500);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const sky = new THREE.Color(0xc9dbe8);
    scene.background = sky;
    const fog = new THREE.Fog(sky, 40, 650);
    scene.fog = fog;
    const hemi = new THREE.HemisphereLight(0xe6f0ff, 0x4d5a33, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(300, 400, 200);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);
    const rig = new THREE.Object3D();
    scene.add(rig);
    rig.add(camera);
    rig.add(buildHood());
    const rearCam = new THREE.PerspectiveCamera(13, 3, 0.5, 900);
    rearCam.position.set(0.35, 0.12, 0.4); rearCam.rotation.y = Math.PI; rig.add(rearCam);
    const leftCam = new THREE.PerspectiveCamera(26, 1.3, 0.5, 900);
    leftCam.position.set(-0.62, -0.25, -0.75); leftCam.rotation.y = Math.PI - 0.22; rig.add(leftCam);
    const rightCam = new THREE.PerspectiveCamera(26, 1.3, 0.5, 900);
    rightCam.position.set(1.25, -0.25, -0.75); rightCam.rotation.y = Math.PI + 0.22; rig.add(rightCam);
    const mirrors = [
      { rect: MR, cam: rearCam, rt: new THREE.WebGLRenderTarget(512, 170) },
      { rect: ML, cam: leftCam, rt: new THREE.WebGLRenderTarget(256, 200) },
      { rect: MRS, cam: rightCam, rt: new THREE.WebGLRenderTarget(256, 200) },
    ];
    mirrors.forEach((m) => { m.rt.texture.repeat.set(-1, 1); m.rt.texture.offset.set(1, 0); });
    const quadMat = new THREE.MeshBasicMaterial({ map: mirrors[0].rt.texture, depthTest: false, depthWrite: false, toneMapped: false });
    const quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadCam.position.z = 0.5;

    let W = 1, H = 1;
    const resize = () => {
      W = mount.clientWidth; H = mount.clientHeight;
      renderer.setSize(W, H);
      camera.aspect = W / H; camera.updateProjectionMatrix();
      const pr = renderer.getPixelRatio();
      for (const m of mirrors) {
        m.cam.aspect = (m.rect.w * W) / (m.rect.h * H); m.cam.updateProjectionMatrix();
        m.rt.setSize(Math.max(2, (m.rect.w * W * pr) | 0), Math.max(2, (m.rect.h * H * pr) | 0));
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    /* ---------- Världen ---------- */
    let lesson: Lesson = LESSONS[0];
    let cond: CondId = "klart";
    let course = generateCourse(lesson);
    let C = buildCourse(course);
    const townGroup = new THREE.Group();
    scene.add(townGroup);
    let world = buildTown(townGroup, course, C);
    const lotGroup = new THREE.Group();
    scene.add(lotGroup);
    let lot: Lot | null = null;

    const applyCond = (c: CondId) => {
      const k = CONDITIONS[c];
      sky.setHex(k.sky);
      fog.color.setHex(k.sky);
      fog.near = k.near; fog.far = k.far;
      sun.intensity = k.sun;
      hemi.intensity = k.hemi;
    };

    /* ---------- Status ---------- */
    type LT = { phase: "green" | "yellow" | "red"; t: number; triggered: boolean; stoppable: boolean };
    type NodeRT = {
      i: number; L: Leg; g: LegG; boxIn: number; boxOut: number; stopLine: number; cpx: number; cpz: number;
      spawned: boolean; bikeSpawned: boolean; checked: boolean; exited: boolean; nav: boolean; minV: number;
      turnWarned: boolean; lookL: boolean; lookR: boolean; exitChecked: boolean; lt: LT;
    };
    type Ped = { S: number; cx: number; cz: number; r: V2; from: 1 | -1; offset: number; state: "wait" | "walk" | "done"; speed: number; obj: THREE.Group; legs: THREE.Mesh[]; checked: boolean };
    type Bike = { path: LanePath; s: number; v: number; node: number; startLocal: number; obj: THREE.Group };
    let nodes: NodeRT[] = [];
    let cars: Car[] = [];
    let peds: Ped[] = [];
    let bikes: Bike[] = [];
    let quizzes: { S: number; id: string; done: boolean }[] = [];
    let zones: { S: number; kmh: number }[] = [];
    let ambientDone: boolean[] = [];
    let finishS = 0;

    const P = { s: 15, v: 0, gas: 0, brake: 0, acc: 0, prevF: 0 };
    const M = { x: 0, z: 0, yaw: 0, v: 0, steer: 0, gear: "D" as "D" | "R", stillT: 0, blinkedRight: false, results: [] as string[], queue: [] as Task[] };
    const G = {
      t: 0, running: false, paused: false, mode: "town" as "town" | "maneuver",
      blinker: null as null | "left" | "right", blinkSince: 0, blinkWarned: false,
      head: 0, yaw: 0, wheel: 0, overT: 0, fogT: 0, faults: [] as string[], eco: [] as string[], said: new Map<string, number>(),
      lastPhase: 0, quizRight: 0, quizTotal: 0, lastBack: -99, accT: 0, brakeT: 0, panelT: 0, panelKey: "",
    };
    const RL = { active: false, done: false, t: 0, bell: 0 };

    /* ---------- Ljud och röst ---------- */
    let actx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let eng: GainNode | null = null;
    const initAudio = () => {
      try {
        if (!actx) {
          actx = new AudioContext();
          osc = actx.createOscillator(); osc.type = "sawtooth";
          const f = actx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
          eng = actx.createGain(); eng.gain.value = 0;
          osc.connect(f); f.connect(eng); eng.connect(actx.destination); osc.start();
        }
        actx.resume();
      } catch { /* inget ljud */ }
    };
    const beep = (freq: number, vol = 0.03, len = 0.04) => {
      if (!actx) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + len + 0.02);
    };
    const speak = (text: string) => {
      if (!settings.current.voice || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "sv-SE"; u.rate = 1.05;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    };
    const say = (text: string, kind: MsgKind, cooldown = 8) => {
      const lastT = G.said.get(text) ?? -1e9;
      if (G.t - lastT < cooldown) return;
      G.said.set(text, G.t);
      if (kind === "bad") G.faults.push(text);
      if (kind === "eco") G.eco.push(text);
      setMsg({ text, kind, id: Math.random() });
      speak(text);
    };

    /* ---------- Trafik ---------- */
    const removeObj = (o: THREE.Object3D) => {
      scene.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.isMesh) { if (m.geometry !== WHEEL_GEO) m.geometry.dispose(); if (m.material !== WHEEL_MAT) (m.material as THREE.Material).dispose(); }
      });
    };
    const addCar = (p: LanePath, s: number, v: number, role: Car["role"], kind: Car["kind"], node: number, boxIn: number) => {
      const m = makeCar(pick(CAR_COLORS));
      scene.add(m.obj);
      cars.push({ path: p, s, v, vWant: v, len: m.len, role, kind, node, boxIn, obj: m.obj });
    };
    const spawnCross = (n: NodeRT, travel: V2, D0: number, role: "priority" | "yield", kind: Car["kind"]) => {
      const p = new LanePath();
      const r = rightOf(travel);
      p.add(n.g.nx - travel[0] * D0 + r[0] * LANE, n.g.nz - travel[1] * D0 + r[1] * LANE);
      p.add(n.g.nx + travel[0] * 130 + r[0] * LANE, n.g.nz + travel[1] * 130 + r[1] * LANE);
      addCar(p, 0, role === "yield" ? 9 : 11, role, kind, n.i, D0 - n.g.Bn);
    };
    const spawnCirc = (n: NodeRT, eta: number) => {
      const travel = n.g.r;
      const r = rightOf(travel);
      const p = new LanePath();
      p.add(n.g.nx - travel[0] * 70 + r[0] * LANE, n.g.nz - travel[1] * 70 + r[1] * LANE);
      addRoundPath(p, n.g.nx, n.g.nz, travel, travel);
      p.add(n.g.nx + travel[0] * 80 + r[0] * LANE, n.g.nz + travel[1] * 80 + r[1] * LANE);
      const Sc = p.closestS(n.cpx, n.cpz);
      addCar(p, Math.max(0, Sc - eta * 7), 7, "priority", "circ", n.i, 70 - RB);
    };
    const spawnAmbient = (i: number) => {
      const g = C.legs[i];
      const travel = neg(g.dir);
      const r = rightOf(travel);
      const a = g.len - g.Bn - 2, b2 = g.startLocal;
      const p = new LanePath();
      p.add(g.x0 + g.dir[0] * a + r[0] * LANE, g.z0 + g.dir[1] * a + r[1] * LANE);
      p.add(g.x0 + g.dir[0] * b2 + r[0] * LANE, g.z0 + g.dir[1] * b2 + r[1] * LANE);
      addCar(p, 0, 12, "ambient", "ambient", -1, 1e9);
    };
    const spawnBike = (n: NodeRT) => {
      const g = n.g;
      const pl = P.s - g.s0 + g.startLocal;
      const startLocal = Math.max(g.startLocal, pl - 18);
      const p = new LanePath();
      p.add(g.x0 + g.dir[0] * startLocal + g.r[0] * 2.95, g.z0 + g.dir[1] * startLocal + g.r[1] * 2.95);
      p.add(g.nx + g.dir[0] * 70 + g.r[0] * 2.95, g.nz + g.dir[1] * 70 + g.r[1] * 2.95);
      const obj = makeCyclist();
      scene.add(obj);
      bikes.push({ path: p, s: 0, v: 5.5, node: n.i, startLocal, obj });
    };

    const clearDynamic = () => {
      cars.forEach((c) => removeObj(c.obj)); cars = [];
      peds.forEach((p) => removeObj(p.obj)); peds = [];
      bikes.forEach((b2) => removeObj(b2.obj)); bikes = [];
    };

    const setupTown = () => {
      clearDynamic();
      disposeGroup(townGroup);
      disposeGroup(lotGroup);
      lot = null;
      course = generateCourse(lesson);
      C = buildCourse(course);
      world = buildTown(townGroup, course, C);
      const last = C.legs.length - 1;
      finishS = C.sOf(last, 18);
      nodes = C.legs.slice(0, -1).map((g, i) => ({
        i, L: course[i], g, boxIn: C.boxIn[i], boxOut: C.boxOut[i], stopLine: C.sOf(i, g.len - g.Bn - 1.3),
        cpx: C.cp[i][0], cpz: C.cp[i][1], spawned: false, bikeSpawned: false, checked: false, exited: false, nav: false,
        minV: 99, turnWarned: false, lookL: false, lookR: false, exitChecked: false,
        lt: { phase: "green", t: 0, triggered: false, stoppable: false },
      }));
      quizzes = [];
      zones = [{ S: -1e9, kmh: 50 }];
      course.forEach((L, i) => {
        const g = C.legs[i];
        for (const it of L.items) {
          const S = C.sOf(i, it.at);
          if (it.kind === "speed") { zones.push({ S, kmh: it.kmh }); if (it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false }); }
          if (it.kind === "sign" && it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false });
          if (it.kind === "rail" && it.quiz) quizzes.push({ S: S + 35, id: "railCross", done: false });
          if (it.kind === "quiz") quizzes.push({ S, id: it.quiz, done: false });
          if ((it.kind === "crosswalk" && it.ped) || it.kind === "walker") {
            if (it.kind === "crosswalk" && it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false });
            const child = it.kind === "crosswalk" && !!it.child;
            const m = makePerson(child);
            scene.add(m.obj);
            peds.push({ S, cx: g.x0 + g.dir[0] * it.at, cz: g.z0 + g.dir[1] * it.at, r: g.r, from: it.from, offset: it.from * 5.4, state: "wait", speed: child ? 1.6 : 1.3, obj: m.obj, legs: m.legs, checked: false });
          } else if (it.kind === "crosswalk" && it.quiz) quizzes.push({ S: S + 15, id: it.quiz, done: false });
        }
        if (L.quizAfter && i < last) quizzes.push({ S: C.boxOut[i] + 20, id: L.quizAfter, done: false });
      });
      if (cond === "dimma" && quizzes.length) quizzes.push({ S: C.sOf(1, 60), id: "g_fog", done: false });
      zones.sort((a, b2) => a.S - b2.S);
      quizzes.sort((a, b2) => a.S - b2.S);
      ambientDone = C.legs.map(() => false);
      Object.assign(P, { s: 15, v: 0, gas: 0, brake: 0, acc: 0, prevF: 15 + HALF_CAR });
      const p0 = C.path.at(P.s);
      G.yaw = Math.atan2(-p0.dx, -p0.dz);
      Object.assign(RL, { active: false, done: false, t: 0, bell: 0 });
    };

    const resetStats = () => {
      Object.assign(G, {
        t: 0, paused: false, mode: "town", blinker: null, blinkSince: 0, blinkWarned: false, head: 0, wheel: 0, overT: 0, fogT: 0,
        faults: [], eco: [], said: new Map(), lastPhase: 0, quizRight: 0, quizTotal: 0, lastBack: -99, accT: 0, brakeT: 0, panelKey: "",
      });
      M.results = [];
      M.queue = [];
    };

    const end = (reason: string, crashed: boolean) => {
      G.running = false;
      setSummary({ lesson: lesson.title, cond: CONDITIONS[cond].name, reason, faults: [...G.faults], eco: [...G.eco], right: G.quizRight, total: G.quizTotal, maneuver: M.results.join(" ") });
      setPhase(crashed ? "crashed" : "finished");
      setPanel(null);
      setRunning(null);
      speak(reason);
    };

    const runTask = (task: Task) => {
      disposeGroup(lotGroup);
      lot = buildLot(lotGroup, task);
      Object.assign(M, { x: lot.start.x, z: lot.start.z, yaw: lot.start.yaw, v: 0, steer: 0, gear: "D", stillT: 0, blinkedRight: false });
      G.blinker = null;
      G.yaw = M.yaw;
      const intro = task === "back"
        ? "Backa in i den gröna rutan så att fronten pekar ut."
        : task === "front"
        ? "Kör in framåt i den gröna rutan och stanna rakt i rutan."
        : "Fickparkera i luckan mellan bilarna, nära trottoarkanten.";
      say(intro, "info", 0);
    };

    const startManeuver = () => {
      clearDynamic();
      G.mode = "maneuver";
      setMode("maneuver");
      M.queue = shuffle(lesson.tasks).slice(0, lesson.maneuvers);
      while (M.queue.length < lesson.maneuvers) M.queue.push(pick(lesson.tasks));
      const first = M.queue.shift()!;
      say("Nu övar vi manövrering.", "info", 0);
      setTimeout(() => runTask(first), 1500);
      runTask(first);
    };

    const start = (id: string) => {
      lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
      cond = pick(lesson.conds);
      applyCond(cond);
      resetStats();
      setupTown();
      G.running = true;
      setSummary(null); setQuiz(null); setMode("town");
      setRunning({ title: lesson.title, cond: CONDITIONS[cond].name });
      setPhase("running");
      initAudio();
      say(`Dagens lektion: ${lesson.title}. ${CONDITIONS[cond].intro} Kör ut från parkeringen när du är redo.`, "info", 0);
    };

    const blink = (dir: "left" | "right") => {
      if (!G.running) return;
      G.blinker = G.blinker === dir ? null : dir;
      G.blinkSince = G.t; G.blinkWarned = false;
      if (G.mode === "maneuver" && G.blinker === "right") M.blinkedRight = true;
      beep(1400);
    };
    const resume = (ok: boolean) => { G.quizTotal++; if (ok) G.quizRight++; G.paused = false; };
    const gear = () => {
      if (G.mode !== "maneuver" || !G.running) return;
      if (Math.abs(M.v) > 0.3) { say("Stanna helt innan du byter mellan framåt och back.", "info", 3); return; }
      M.gear = M.gear === "D" ? "R" : "D";
      beep(600, 0.03, 0.08);
    };
    const quit = () => { if (G.running) { M.results.push("Manövreringen avbröts."); end("Lektionen är slut.", false); } };
    api.current = { start, blink, resume, gear, quit };

    const limitAt = (s: number) => { let k = 50; for (const z of zones) if (s >= z.S) k = z.kmh; return k; };

    /* ---------- Stadskörning ---------- */
    const updateTown = (dt: number) => {
      const k = keys.current;
      const path = C.path;
      P.gas = k.up ? Math.min(1, P.gas + dt * 1.0) : Math.max(0, P.gas - dt * 2.5);
      P.brake = k.down ? Math.min(1, P.brake + dt * 2.5) : Math.max(0, P.brake - dt * 4);
      const acc = P.gas * 2.5 * Math.max(0, 1 - P.v / 30) - P.brake * 7.5 - (P.v > 0.05 ? 0.25 + 0.0004 * P.v * P.v : 0);
      const vPrev = P.v;
      P.v = Math.max(0, P.v + acc * dt);
      const realAcc = (P.v - vPrev) / Math.max(dt, 1e-4);
      P.acc += (realAcc - P.acc) * Math.min(1, dt * 3);
      P.s = Math.min(path.total - 1, P.s + P.v * dt);
      const Sf = P.s + HALF_CAR;
      const prevF = P.prevF;
      P.prevF = Sf;
      const crossed = (line: number) => prevF < line && Sf >= line;
      const kmh = P.v * 3.6;

      // Miljöanpassad körning
      G.accT = P.acc > 1.9 ? G.accT + dt : G.accT < 0 ? Math.min(0, G.accT + dt) : 0;
      if (G.accT > 1.5) { say("Miljöanpassad körning: accelerera mjukare, det sparar bränsle och är säkrare.", "eco", 20); G.accT = -8; }
      G.brakeT = P.acc < -4.5 && P.v > 2 ? G.brakeT + dt : 0;
      if (G.brakeT > 0.5) { say("Planera körningen och släpp gasen i god tid, så slipper du bromsa hårt.", "eco", 20); G.brakeT = -3; }

      // Blinkers bortglömda
      if (G.blinker && !G.blinkWarned && G.t - G.blinkSince > 15) {
        const soon = nodes.some((n) => !n.exited && n.L.turn !== "straight" && n.boxIn - Sf < 130);
        if (!soon) { G.blinkWarned = true; say("Glöm inte att slå av blinkersen.", "bad"); }
      }

      // Hastighet – ingen säger vad som gäller, du måste läsa skyltarna själv
      const lim = limitAt(P.s);
      G.overT = kmh > lim + 3 ? G.overT + dt : G.overT < 0 ? Math.min(0, G.overT + dt) : 0;
      if (G.overT > 2.5) { say("Du kör för fort. Håll koll på hastighetsskyltarna.", "bad", 0); G.overT = -10; }
      if (cond === "dimma") {
        const tooFast = kmh > lim - 8 && kmh <= lim + 3;
        G.fogT = tooFast ? G.fogT + dt : G.fogT < 0 ? Math.min(0, G.fogT + dt) : 0;
        if (G.fogT > 4) { say("Du kör för fort för sikten. Anpassa farten efter förhållandena.", "bad", 0); G.fogT = -12; }
      }

      C.legs.forEach((g, i) => {
        if (ambientDone[i] || g.len < 200) return;
        const local = P.s - g.s0 + g.startLocal;
        if (local > g.startLocal + 10 && local < g.len - 150) { ambientDone[i] = true; spawnAmbient(i); }
      });

      // Korsningar
      for (const n of nodes) {
        const L = n.L;
        const dEntry = n.boxIn - Sf;
        if (dEntry < 70 && dEntry > -1) { if (G.head > 1.0) n.lookL = true; if (G.head < -1.0) n.lookR = true; }

        if (!n.nav && dEntry < 110 && dEntry > 0) {
          n.nav = true;
          const t = L.turn;
          const text = L.control === "exit" ? `Vid utfarten svänger vi ${turnWord(t)}.`
            : L.control === "infart" ? `Sväng ${turnWord(t)} in på parkeringen.`
            : L.control === "round" ? `I cirkulationsplatsen ${t === "right" ? "tar vi första utfarten till höger" : t === "straight" ? "kör vi rakt fram, andra utfarten" : "tar vi tredje utfarten, till vänster"}.`
            : t === "straight" ? "I nästa korsning kör vi rakt fram." : `I nästa korsning svänger vi ${turnWord(t)}.`;
          say(text, "info", 0);
        }

        if (!n.spawned && dEntry < 70) {
          n.spawned = true;
          const eta = Math.max(1.5, dEntry / Math.max(P.v, 6));
          const D = clamp(eta * 11 + n.g.Bn, 22, 85);
          if (L.control === "round") { if (L.circ) spawnCirc(n, eta); }
          else if (L.control !== "light") {
            if (L.cross) {
              const travel = L.cross === "right" ? neg(n.g.r) : n.g.r;
              if (L.crossYields) spawnCross(n, travel, 32, "yield", "cross");
              else spawnCross(n, travel, D, "priority", "cross");
            }
            if (L.oncoming) spawnCross(n, neg(n.g.dir), D, "priority", "oncoming");
          }
        }
        if (L.cyclist && !n.bikeSpawned && dEntry < 90) { n.bikeSpawned = true; spawnBike(n); }

        if (L.control === "stop" && Sf > n.stopLine - 12 && Sf <= n.stopLine + 0.5) n.minV = Math.min(n.minV, P.v);

        if (L.control === "light") {
          const lt = n.lt;
          const dLine = n.stopLine - Sf;
          if (!lt.triggered && dLine < 75) { lt.triggered = true; lt.phase = "yellow"; lt.t = 0; lt.stoppable = dLine > (P.v * P.v) / 8 + P.v * 0.8; }
          if (lt.triggered) {
            lt.t += dt;
            if (lt.phase === "yellow" && lt.t > 3) { lt.phase = "red"; lt.t = 0; spawnCross(n, n.g.r, 60, "priority", "cross"); }
            else if (lt.phase === "red" && lt.t > 9) { lt.phase = "green"; lt.t = 0; if (L.oncoming) spawnCross(n, neg(n.g.dir), 40, "priority", "oncoming"); }
          }
          const mats = world.lights[n.i];
          if (mats) {
            mats.red.color.setHex(lt.phase === "red" ? 0xff2a1a : 0x330000);
            mats.yellow.color.setHex(lt.phase === "yellow" ? 0xffc21a : 0x332800);
            mats.green.color.setHex(lt.phase === "green" ? 0x22ff66 : 0x003311);
          }
          if (lt.phase !== "green" && dLine > 0 && dLine < 60 && P.gas > 0.4) say("Släpp gasen i god tid när det är rött eller gult framåt.", "eco", 20);
        }

        if (!n.checked && Sf >= n.boxIn - 0.5) {
          n.checked = true;
          const needsBoth = ["none", "yield", "stop", "exit"].includes(L.control);
          if (L.control === "round") {
            if (!n.lookL) say("Titta åt vänster mot trafiken i cirkulationsplatsen innan du kör in.", "bad", 2);
            if (L.turn === "right" && G.blinker !== "right") say("Ska du ta första utfarten ska du blinka höger redan före cirkulationsplatsen.", "bad", 2);
            if (L.turn !== "right" && G.blinker === "left") say("I en cirkulationsplats behöver du inte blinka vänster vid infarten.", "info", 2);
          } else {
            if (L.turn !== "straight") {
              if (G.blinker !== L.turn) say(G.blinker ? `Fel blinkers. Du skulle blinka ${turnWord(L.turn)}.` : `Du blinkade inte innan du svängde ${turnWord(L.turn)}.`, "bad", 2);
              else if (G.t - G.blinkSince < 2) say("Blinka i god tid före svängen, minst ett par sekunder innan.", "bad", 2);
            } else if (G.blinker) say("Du blinkade men körde rakt fram. Slå av blinkersen.", "bad", 2);
            const miss: string[] = [];
            if ((needsBoth || L.turn === "left") && !n.lookL) miss.push("vänster");
            if ((needsBoth || L.turn === "right") && !n.lookR) miss.push("höger");
            if (miss.length) say(L.turn !== "straight" && !needsBoth
              ? `Du kollade inte döda vinkeln åt ${miss[0]} innan svängen.`
              : `Titta åt ${miss.join(" och ")} innan du kör in i korsningen.`, "bad", 2);
          }
          if (L.control === "stop" && n.minV > 0.4) say("Du stannade inte helt vid stopplikten.", "bad", 2);
          if (L.control === "light") {
            if (n.lt.phase === "red") say("Du körde mot rött ljus.", "bad", 2);
            else if (n.lt.phase === "yellow" && n.lt.stoppable) say("Gult ljus betyder stopp om du kan stanna säkert.", "bad", 2);
          }
          for (const c of cars) {
            if (c.node !== n.i || c.role !== "priority") continue;
            const cp = c.path.at(c.s);
            const dx = n.cpx - cp.x, dz = n.cpz - cp.z;
            const dist = Math.hypot(dx, dz);
            const approaching = cp.dx * dx + cp.dz * dz > 0;
            if (dist < 7 || (approaching && dist < 45 && dist / Math.max(c.v, 1) < 3.2)) {
              say(
                c.kind === "oncoming" ? "Du ska släppa fram mötande trafik när du svänger vänster."
                  : c.kind === "circ" ? "Du hade väjningsplikt mot bilen i cirkulationsplatsen."
                  : L.control === "none" ? "Högerregeln gäller. Du skulle ha släppt fram bilen från höger."
                  : L.control === "exit" ? "Utfartsregeln. Du ska släppa fram alla på vägen när du kör ut."
                  : L.control === "light" ? "Du hade inte företräde. Släpp fram trafiken som har grönt."
                  : "Du lämnade inte företräde åt korsande trafik.",
                "bad", 2
              );
              break;
            }
          }
          if (L.turn === "right" && L.control !== "round") {
            const pl = Sf - n.g.s0 + n.g.startLocal;
            for (const b2 of bikes) {
              if (b2.node !== n.i) continue;
              const bl = b2.startLocal + b2.s;
              if (bl > pl - 20 && bl < n.g.len - n.g.Bn + 2) { say("Du svängde framför en cyklist. Titta över höger axel och släpp fram cyklister som kör rakt fram.", "bad", 2); break; }
            }
          }
        }
        const inBox = Sf > n.boxIn && P.s - HALF_CAR < n.boxOut;
        if (inBox && L.turn !== "straight" && !n.turnWarned) {
          const maxK = L.control === "round" ? 25 : L.turn === "right" ? 20 : 25;
          if (kmh > maxK + 2) { n.turnWarned = true; say("För hög fart i svängen. Sänk farten innan du svänger.", "bad", 2); }
        }
        if (L.control === "round" && !n.exitChecked && crossed(n.boxOut - 5)) {
          n.exitChecked = true;
          if (G.blinker !== "right") say("Blinka höger innan du kör ut ur cirkulationsplatsen.", "bad", 2);
        }
        if (!n.exited && P.s - HALF_CAR > n.boxOut) {
          n.exited = true;
          if ((L.turn !== "straight" || L.control === "round") && G.blinker) G.blinker = null;
        }
      }

      // Järnväg
      const R = world.rail;
      if (R) {
        const stopS = C.sOf(R.i, R.at - 7.0), barrierS = C.sOf(R.i, R.at - 5.5), crossS = C.sOf(R.i, R.at);
        if (!RL.active && !RL.done && stopS - Sf < 130) { RL.active = true; RL.t = 0; }
        let angle = -Math.PI / 2;
        let front = -600;
        if (RL.active) {
          RL.t += dt;
          const t = RL.t;
          if (t < 4) angle = -Math.PI / 2;
          else if (t < 7) angle = (-Math.PI / 2) * (1 - (t - 4) / 3);
          else if (t < 18) angle = 0;
          else if (t < 21) angle = (-Math.PI / 2) * ((t - 18) / 3);
          else { RL.active = false; RL.done = true; }
          front = (t - 11) * 22;
          const on = t < 20 && Math.floor(t * 2.5) % 2 === 0;
          R.lamps.forEach((m, idx) => m.color.setHex(t < 20 && (idx % 2 === 0) === on ? 0xff2020 : 0x330000));
          RL.bell -= dt;
          if (t < 20 && RL.bell <= 0) { RL.bell = 0.5; beep(880, 0.025, 0.12); }
          if (crossed(stopS) && t < 20) say("Stanna när ljussignalerna blinkar vid järnvägskorsningen.", "bad", 2);
          if (crossed(barrierS) && t > 5 && t < 19) { end("Du körde in i bommen vid järnvägskorsningen.", true); return; }
          if (front > -3.5 && front - 55 < 3.5 && Math.abs(P.s - crossS) < 3.5) { end("Du blev påkörd av tåget.", true); return; }
        } else R.lamps.forEach((m) => m.color.setHex(0x330000));
        R.arms.forEach((a) => (a.rotation.x = angle));
        R.train.position.set(R.cx + R.r[0] * front, 0, R.cz + R.r[1] * front);
      }

      // Gående
      for (const p of peds) {
        const dS = p.S - Sf;
        if (p.state === "wait" && ((dS < 45 && dS > 14) || (P.v < 1 && dS < 45 && dS > 0))) p.state = "walk";
        if (p.state === "walk") {
          p.offset += -p.from * p.speed * dt;
          if (-p.from * p.offset > 5.4) p.state = "done";
          const ph = Math.sin(G.t * 9);
          p.legs[0].rotation.x = ph * 0.5; p.legs[1].rotation.x = -ph * 0.5;
        } else p.legs.forEach((l) => (l.rotation.x = 0));
        p.obj.position.set(p.cx + p.r[0] * p.offset, Math.abs(p.offset) > 3.5 ? 0.14 : 0, p.cz + p.r[1] * p.offset);
        p.obj.rotation.y = Math.atan2(p.r[0] * -p.from, p.r[1] * -p.from);
        if (!p.checked && crossed(p.S - 1.6)) {
          p.checked = true;
          if (p.state === "walk" && Math.abs(p.offset) < 5) say("Du lämnade inte företräde åt den gående.", "bad", 2);
        }
        if (Math.abs(P.s - p.S) < HALF_CAR + 0.3 && p.offset > LANE - 1.2 && p.offset < LANE + 1.2) { end("Du körde på en gående.", true); return; }
      }

      // Bilar
      const pc = path.at(P.s);
      for (const c of cars) {
        const n = c.node >= 0 ? nodes[c.node] : null;
        const front = c.s + c.len / 2;
        let want = c.vWant;
        if (c.role === "yield" && n && !n.exited) {
          const dist = c.boxIn - 1.5 - front;
          want = dist <= 0.3 ? 0 : Math.min(c.vWant, Math.sqrt(6 * dist));
        }
        if (c.role === "priority" && n) {
          const pIn = Sf > n.boxIn - 1 && P.s - HALF_CAR < n.boxOut;
          if (pIn) {
            const cp = c.path.at(c.s);
            const dx = pc.x - cp.x, dz = pc.z - cp.z;
            if (Math.hypot(dx, dz) < 16 && cp.dx * dx + cp.dz * dz > 0) want = 0;
          }
        }
        c.v = want < c.v ? Math.max(want, c.v - 8 * dt) : Math.min(want, c.v + 2 * dt);
        c.s += c.v * dt;
        const pt = c.path.at(c.s);
        c.obj.position.set(pt.x, 0, pt.z);
        c.obj.rotation.y = Math.atan2(pt.dx, pt.dz);
      }
      cars = cars.filter((c) => { const keep = c.s < c.path.total - 1; if (!keep) removeObj(c.obj); return keep; });

      // Cyklister
      for (const b2 of bikes) {
        const n = nodes[b2.node];
        let want = 5.5;
        const pIn = Sf > n.boxIn - 1 && P.s - HALF_CAR < n.boxOut;
        const bp = b2.path.at(b2.s);
        if (pIn) { const dx = pc.x - bp.x, dz = pc.z - bp.z; if (Math.hypot(dx, dz) < 9 && bp.dx * dx + bp.dz * dz > 0) want = 0; }
        b2.v = want < b2.v ? Math.max(want, b2.v - 6 * dt) : Math.min(want, b2.v + 1.5 * dt);
        b2.s += b2.v * dt;
        const pt = b2.path.at(b2.s);
        b2.obj.position.set(pt.x, 0, pt.z);
        b2.obj.rotation.y = Math.atan2(pt.dx, pt.dz);
        for (let k2 = -1; k2 <= 1; k2++) {
          const pp = path.at(P.s + k2 * 1.5);
          if (Math.hypot(pt.x - pp.x, pt.z - pp.z) < 1.3) { end("Du körde på en cyklist.", true); return; }
        }
      }
      bikes = bikes.filter((b2) => { const keep = b2.s < b2.path.total - 1; if (!keep) removeObj(b2.obj); return keep; });

      // Krock med bil
      for (const c of cars) {
        const cc = c.path.at(c.s);
        if (Math.hypot(cc.x - pc.x, cc.z - pc.z) > 12) continue;
        for (let a = -1; a <= 1; a++) {
          const cp = c.path.at(c.s + (a * c.len) / 3);
          for (let b3 = -1; b3 <= 1; b3++) {
            const pp = path.at(P.s + b3 * 1.5);
            if (Math.hypot(cp.x - pp.x, cp.z - pp.z) < 1.75) { end("Du krockade med en annan bil.", true); return; }
          }
        }
      }

      // Teorifrågor
      if (settings.current.quiz) {
        const busy = nodes.some((n) => { const d = n.boxIn - Sf; return (d < 45 && d > -2) || (Sf > n.boxIn && P.s - HALF_CAR < n.boxOut); });
        if (!busy) {
          for (const q of quizzes) {
            if (!q.done && P.s > q.S) {
              q.done = true;
              const base = QUIZ[q.id];
              if (base) {
                const order = shuffle(base.options.map((_, i) => i));
                G.paused = true;
                setQuizPick(null);
                setQuiz({ ...base, options: order.map((i) => base.options[i]), correct: order.indexOf(base.correct) });
              }
              break;
            }
          }
        }
      }

      if (P.s > finishS) startManeuver();
    };

    /* ---------- Manövrering ---------- */
    const updateManeuver = (dt: number) => {
      const k = keys.current;
      if (!lot) return;
      const target = (k.left ? 1 : 0) - (k.right ? 1 : 0);
      if (target !== 0) M.steer += Math.sign(target - M.steer) * Math.min(Math.abs(target - M.steer), dt * 1.3);
      else M.steer -= Math.sign(M.steer) * Math.min(Math.abs(M.steer), dt * 0.8);
      P.gas = k.up ? Math.min(1, P.gas + dt * 1.5) : Math.max(0, P.gas - dt * 3);
      P.brake = k.down ? Math.min(1, P.brake + dt * 3) : Math.max(0, P.brake - dt * 4);
      const dir = M.gear === "D" ? 1 : -1;
      const toward = (v: number, t: number, d: number) => (v > t ? Math.max(t, v - d) : Math.min(t, v + d));
      if (P.gas > 0) M.v += dir * 1.4 * P.gas * dt; else M.v = toward(M.v, 0, 0.6 * dt);
      if (P.brake > 0) M.v = toward(M.v, 0, 6 * P.brake * dt);
      M.v = dir > 0 ? Math.min(M.v, 4.5) : Math.max(M.v, -2.2);
      const yawRate = (M.v / 2.7) * Math.tan(M.steer * 0.6);
      const nyaw = M.yaw + yawRate * dt;
      const nx = M.x - Math.sin(nyaw) * M.v * dt, nz = M.z - Math.cos(nyaw) * M.v * dt;
      const me = { x: nx, z: nz, yaw: nyaw, hx: 0.92, hz: 2.25 };
      const hit = lot.obstacles.find((o) => obbHit(me, o));
      if (hit) {
        M.v = 0;
        say(hit.kind === "curb" ? "Du körde upp på trottoarkanten. Kör försiktigt och använd speglarna." : "Du nuddade en parkerad bil. Kör långsamt och titta runt dig.", "bad", 4);
      } else { M.x = nx; M.z = nz; M.yaw = nyaw; }
      if (Math.abs(M.v) * 3.6 > 10.5) say("Håll gångfart på parkeringen.", "bad", 10);
      if (M.gear === "R" && M.v < -0.3 && G.t - G.lastBack > 4) say("Titta bakåt innan och medan du backar. Håll in mellanslag.", "bad", 12);
      P.acc = 0;

      M.stillT = Math.abs(M.v) < 0.05 ? M.stillT + dt : 0;
      if (M.stillT > 1.5) {
        const corners = obbCorners({ x: M.x, z: M.z, yaw: M.yaw, hx: 0.92, hz: 2.25 });
        let ok = false;
        let reason = "";
        if (lot.bay) {
          const b2 = lot.bay;
          const inside = corners.every(([x, z]) => x > b2.x0 - 0.15 && x < b2.x1 + 0.15 && z > b2.z0 - 0.15 && z < b2.z1 + 0.15);
          const err = Math.abs(angDiff(M.yaw, b2.yaw)) * (180 / Math.PI);
          ok = inside && err < 10;
          if (!inside) reason = "Bilen står inte helt inne i rutan.";
          else if (err >= 10) reason = lot.task === "back" ? "Bilen står snett eller med fronten åt fel håll. Den ska stå rakt med fronten utåt." : "Bilen står snett i rutan.";
        } else if (lot.gap) {
          const gp = lot.gap;
          const inside = corners.every(([x]) => x > gp.xMin + 0.05 && x < gp.xMax - 0.05);
          const sideGap = Math.min(...corners.map(([, z]) => z)) - gp.curbZ;
          const err = Math.abs(angDiff(M.yaw, gp.yaw)) * (180 / Math.PI);
          ok = inside && sideGap < 0.45 && err < 8;
          if (!inside) reason = "Bilen står inte helt i luckan.";
          else if (sideGap >= 0.45) reason = "Bilen står för långt från trottoarkanten.";
          else if (err >= 8) reason = "Bilen står snett mot trottoarkanten.";
        }
        if (ok) {
          if (lot.task === "parallel" && !M.blinkedRight) say("Kom ihåg att blinka höger när du ska köra in till kanten och fickparkera.", "bad", 0);
          M.results.push(lot.task === "back" ? "Backparkering klar." : lot.task === "front" ? "Framåtparkering klar." : "Fickparkering klar.");
          const next = M.queue.shift();
          if (next) { say("Bra! Nu tar vi nästa övning.", "good", 0); runTask(next); }
          else end("Snyggt parkerat! Lektionen är slut.", false);
          return;
        }
        if (reason) say(`${reason} Justera och stanna igen.`, "info", 6);
        M.stillT = -3;
      }
    };

    /* ---------- Kamera, instrument och regelpanel ---------- */
    const place = (dt: number) => {
      const k = keys.current;
      const lookL = k.lookL || (G.mode === "town" && k.left);
      const lookR = k.lookR || (G.mode === "town" && k.right);
      const headTarget = k.back ? 2.8 : (lookL ? 1.75 : 0) + (lookR ? -1.75 : 0);
      G.head += (headTarget - G.head) * Math.min(1, dt * 6);
      if (G.head > 2.3) G.lastBack = G.t;
      if (G.mode === "town") {
        const path = C.path;
        const p = path.at(P.s);
        const target = Math.atan2(-p.dx, -p.dz);
        G.yaw += angDiff(target, G.yaw) * Math.min(1, dt * 8);
        rig.position.set(p.x + p.dz * 0.35, EYE_H, p.z - p.dx * 0.35);
        const b2 = path.at(P.s + 4);
        const cross = p.dx * b2.dz - p.dz * b2.dx;
        G.wheel += (clamp(((Math.asin(clamp(cross, -1, 1)) * 180) / Math.PI) * 5, -360, 360) - G.wheel) * Math.min(1, dt * 5);
      } else {
        G.yaw = M.yaw;
        rig.position.set(M.x - Math.cos(M.yaw) * 0.35, EYE_H, M.z + Math.sin(M.yaw) * 0.35);
        G.wheel = -M.steer * 450;
      }
      rig.rotation.set(0, G.yaw, 0);
      camera.rotation.set(clamp(P.acc * 0.006, -0.05, 0.03), G.head, 0, "YXZ");
    };

    const drawMap = () => {
      const cv = mapRef.current;
      if (!cv || !lot) return;
      const ctx = cv.getContext("2d")!;
      const Wc = cv.width, Hc = cv.height, s = 6.5;
      const [cx, cz] = lot.center;
      const tx = (x: number) => (x - cx) * s + Wc / 2, tz = (z: number) => (z - cz) * s + Hc / 2;
      ctx.fillStyle = "#2b2d31"; ctx.fillRect(0, 0, Wc, Hc);
      const polyO = (o: { x: number; z: number; yaw: number; hx: number; hz: number }, fill: string) => {
        const c = obbCorners(o);
        ctx.beginPath(); ctx.moveTo(tx(c[0][0]), tz(c[0][1])); for (const p of c.slice(1)) ctx.lineTo(tx(p[0]), tz(p[1])); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      ctx.fillStyle = "rgba(34,197,94,0.45)";
      if (lot.bay) ctx.fillRect(tx(lot.bay.x0), tz(lot.bay.z0), (lot.bay.x1 - lot.bay.x0) * s, (lot.bay.z1 - lot.bay.z0) * s);
      if (lot.gap) ctx.fillRect(tx(lot.gap.xMin), tz(lot.gap.curbZ), (lot.gap.xMax - lot.gap.xMin) * s, 2 * s);
      for (const o of lot.obstacles) polyO(o, o.kind === "curb" ? "#8f8a80" : "#9aa3ad");
      ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
      for (const [x1, z1, x2, z2] of lot.segs) { ctx.beginPath(); ctx.moveTo(tx(x1), tz(z1)); ctx.lineTo(tx(x2), tz(z2)); ctx.stroke(); }
      polyO({ x: M.x, z: M.z, yaw: M.yaw, hx: 0.92, hz: 2.25 }, "#3b82f6");
      const fx = M.x - Math.sin(M.yaw) * 2.0, fz = M.z - Math.cos(M.yaw) * 2.0;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(tx(fx), tz(fz), 3, 0, Math.PI * 2); ctx.fill();
    };

    const updatePanel = () => {
      let p: Panel = null;
      if (G.running && settings.current.help) {
        if (G.mode === "town") {
          const Sf = P.s + HALF_CAR;
          const kmh = P.v * 3.6;
          const extra: string[] = [];
          const ped = peds.find((x) => x.S - Sf > 0 && x.S - Sf < 70 && x.state !== "done");
          if (ped) extra.push("Gående framåt: släpp fram dem som är på väg ut eller går över.");
          if (RL.active) extra.push("Järnvägskorsning: stanna när ljuset blinkar och bommarna fälls.");
          if (cond === "dimma") extra.push("Dålig sikt: anpassa farten efter förhållandena.");
          const n = nodes.find((x) => !x.exited);
          if (n && n.boxIn - Sf < 160) {
            const L = n.L;
            const checks: { t: string; ok: boolean | null }[] = [];
            const needsBoth = ["none", "yield", "stop", "exit"].includes(L.control);
            if (L.control === "round") {
              checks.push({ t: "Titta åt vänster mot trafiken i cirkulationen (A / ←)", ok: n.lookL });
              if (L.turn === "right") checks.push({ t: "Blinka höger redan före infarten (E)", ok: G.blinker === "right" });
              checks.push({ t: "Sänk farten under 25 km/h", ok: kmh <= 25 });
              checks.push({ t: "Släpp fram bilar som redan kör i cirkulationen", ok: null });
              checks.push({ t: "Blinka höger innan du kör ut (E)", ok: Sf > n.boxIn ? G.blinker === "right" : null });
            } else {
              if (needsBoth) {
                checks.push({ t: "Titta åt vänster (A / ←)", ok: n.lookL });
                checks.push({ t: "Titta åt höger (D / →)", ok: n.lookR });
              }
              if (L.turn === "right") {
                if (!needsBoth) checks.push({ t: "Kolla spegeln och döda vinkeln åt höger (D / →)", ok: n.lookR });
                checks.push({ t: "Blinka höger i god tid (E)", ok: G.blinker === "right" });
                checks.push({ t: "Sänk farten under 20 km/h", ok: kmh <= 20 });
                checks.push({ t: "Håll till höger och släpp fram cyklister och gående", ok: null });
              } else if (L.turn === "left") {
                if (!needsBoth) checks.push({ t: "Kolla spegeln och döda vinkeln åt vänster (A / ←)", ok: n.lookL });
                checks.push({ t: "Blinka vänster i god tid (Q)", ok: G.blinker === "left" });
                checks.push({ t: "Sänk farten under 25 km/h", ok: kmh <= 25 });
                checks.push({ t: "Placera dig nära mitten och släpp fram mötande", ok: null });
              } else if (G.blinker) checks.push({ t: "Slå av blinkersen, du ska köra rakt fram", ok: false });
              if (L.control === "stop") checks.push({ t: "Stanna helt vid stopplinjen", ok: n.minV < 0.4 });
              if (L.control === "light") checks.push({ t: `Signalen visar ${n.lt.phase === "green" ? "grönt" : n.lt.phase === "yellow" ? "gult" : "rött"}`, ok: n.lt.phase === "green" });
            }
            p = { title: CONTROL_INFO[L.control].title, rule: CONTROL_INFO[L.control].rule, checks, extra };
          } else p = { title: "Körning", rule: "Var uppmärksam på skyltar och andra trafikanter. Kör mjukt och planera i god tid.", checks: [], extra };
        } else if (lot) {
          const lookedBack = G.t - G.lastBack < 4;
          const checks: { t: string; ok: boolean | null }[] = [];
          if (lot.task === "parallel") checks.push({ t: "Blinka höger när du ska in till kanten (E)", ok: M.blinkedRight });
          if (lot.task !== "front") {
            checks.push({ t: "Lägg i backen (R)", ok: M.gear === "R" });
            checks.push({ t: "Titta bakåt medan du backar (håll mellanslag)", ok: lookedBack });
          }
          checks.push({ t: "Håll gångfart", ok: Math.abs(M.v) * 3.6 <= 10 });
          p = {
            title: lot.task === "back" ? "Backparkering" : lot.task === "front" ? "Framåtparkering" : "Fickparkering",
            rule: lot.task === "back" ? "Backa in i den gröna rutan och stanna rakt med fronten utåt."
              : lot.task === "front" ? "Kör in i den gröna rutan och stanna rakt i rutan."
              : "Backa in i luckan och stanna rakt, högst cirka 30–40 cm från trottoarkanten.",
            checks,
            extra: ["Styr med ← / →, gas ↑, broms ↓. Byt mellan framåt och back med R."],
          };
        }
      }
      const key = JSON.stringify(p);
      if (key !== G.panelKey) { G.panelKey = key; setPanel(p); }
    };

    const hud = () => {
      const kmh = Math.abs(G.mode === "town" ? P.v : M.v) * 3.6;
      needleRef.current?.setAttribute("transform", `rotate(${-120 + (Math.min(120, kmh) / 120) * 240} 50 50)`);
      if (speedRef.current) speedRef.current.textContent = String(Math.round(kmh));
      wheelRef.current?.setAttribute("transform", `rotate(${G.wheel} 50 50)`);
      if (gearRef.current) gearRef.current.textContent = G.mode === "town" ? "D" : M.gear;
      const on = !!G.blinker && Math.floor((G.t - G.blinkSince) / 0.38) % 2 === 0;
      if (blinkLRef.current) blinkLRef.current.style.opacity = G.blinker === "left" && on ? "1" : "0.15";
      if (blinkRRef.current) blinkRRef.current.style.opacity = G.blinker === "right" && on ? "1" : "0.15";
      if (btnLRef.current) btnLRef.current.style.background = G.blinker === "left" ? (on ? "#f59e0b" : "#b45309") : "rgba(30,30,34,0.85)";
      if (btnRRef.current) btnRRef.current.style.background = G.blinker === "right" ? (on ? "#f59e0b" : "#b45309") : "rgba(30,30,34,0.85)";
      const vis = String(clamp(1 - (Math.abs(G.head) - 0.3) * 2, 0, 1));
      if (dashRef.current) dashRef.current.style.opacity = vis;
      if (frameRef.current) frameRef.current.style.opacity = vis;
      if (navRef.current && navTextRef.current && navArrowRef.current) {
        const Sf = P.s + HALF_CAR;
        const next = nodes.find((n) => !n.exited);
        if (G.running && G.mode === "town" && next) {
          const d = Math.max(0, Math.round((next.boxIn - Sf) / 10) * 10);
          navRef.current.style.display = d < 250 ? "flex" : "none";
          const t = next.L.turn;
          navTextRef.current.textContent = next.L.control === "round"
            ? `Cirkulationsplats om ${d} m: ${t === "right" ? "första utfarten" : t === "straight" ? "andra utfarten" : "tredje utfarten"}`
            : t === "straight" ? `Rakt fram om ${d} m` : `Sväng ${turnWord(t)} om ${d} m`;
          navArrowRef.current.style.transform = `rotate(${t === "right" ? 90 : t === "left" ? -90 : 0}deg)`;
        } else navRef.current.style.display = "none";
      }
      if (actx && osc && eng) {
        const band = 20, frac = (kmh % band) / band;
        osc.frequency.setTargetAtTime(30 + frac * 35 + P.gas * 10 + Math.floor(kmh / band) * 2, actx.currentTime, 0.08);
        eng.gain.setTargetAtTime(G.running && !G.paused ? 0.02 + P.gas * 0.02 : 0, actx.currentTime, 0.2);
      }
    };

    const blinkTick = () => {
      if (!G.blinker || !G.running || G.paused) return;
      const ph = Math.floor((G.t - G.blinkSince) / 0.38) % 2;
      if (ph !== G.lastPhase) { G.lastPhase = ph; beep(ph === 0 ? 1400 : 1000); }
    };

    const render = () => {
      const showM = Math.abs(G.head) < 0.5;
      renderer.setScissorTest(false);
      if (showM) for (const m of mirrors) { renderer.setRenderTarget(m.rt); renderer.render(scene, m.cam); }
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, W, H);
      renderer.render(scene, camera);
      if (showM) {
        renderer.autoClear = false;
        renderer.setScissorTest(true);
        for (const m of mirrors) {
          const x = m.rect.x * W, y = H - (m.rect.y + m.rect.h) * H, w = m.rect.w * W, h = m.rect.h * H;
          renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
          quadMat.map = m.rt.texture;
          renderer.render(quadScene, quadCam);
        }
        renderer.setScissorTest(false);
        renderer.autoClear = true;
        renderer.setViewport(0, 0, W, H);
      }
    };

    /* ---------- Tangentbord ---------- */
    const map: Record<string, keyof Keys> = {
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      ArrowLeft: "left", ArrowRight: "right", KeyA: "lookL", KeyD: "lookR", Space: "back",
    };
    const kd = (e: KeyboardEvent) => {
      if (map[e.code]) { e.preventDefault(); keys.current[map[e.code]] = true; }
      if (e.repeat) return;
      if (e.code === "KeyQ") blink("left");
      if (e.code === "KeyE") blink("right");
      if (e.code === "KeyR") gear();
    };
    const ku = (e: KeyboardEvent) => { if (map[e.code]) keys.current[map[e.code]] = false; };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    applyCond(cond);
    setupTown();
    let raf = 0;
    let lastT = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      if (G.running && !G.paused) {
        G.t += dt;
        if (G.mode === "town") updateTown(dt); else updateManeuver(dt);
        blinkTick();
      }
      place(dt);
      hud();
      if (G.mode === "maneuver") drawMap();
      G.panelT -= dt;
      if (G.panelT <= 0) { G.panelT = 0.2; updatePanel(); }
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      actx?.close();
      mirrors.forEach((m) => m.rt.dispose());
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const selectLesson = (id: string) => {
    const L = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
    setLessonId(L.id);
    setHelp(L.help);
    setQuizOn(L.quiz);
    settings.current.help = L.help;
    settings.current.quiz = L.quiz;
  };
  const startLesson = (id: string) => { selectLesson(id); api.current?.start(id); };
  const randomLesson = (exclude?: string) => pick(LESSONS.filter((l) => l.id !== exclude)).id;

  const hold = (k: keyof Keys) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); keys.current[k] = true; },
    onPointerUp: () => { keys.current[k] = false; },
    onPointerLeave: () => { keys.current[k] = false; },
    onPointerCancel: () => { keys.current[k] = false; },
  });

  const countList = (list: string[]) => Object.entries(list.reduce<Record<string, number>>((acc, f) => { acc[f] = (acc[f] || 0) + 1; return acc; }, {}));
  const ticks = Array.from({ length: 13 }, (_, i) => i * 10);
  const mirrorStyle = (r: typeof MR, radius: string) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, boxShadow: "0 0 0 5px #121212, 0 6px 14px rgba(0,0,0,.5)", borderRadius: radius });

  const lessonPicker = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {LESSONS.map((l) => (
        <button
          key={l.id}
          onClick={() => selectLesson(l.id)}
          className={`rounded-xl p-3 text-left text-sm border ${lessonId === l.id ? "border-sky-400 bg-sky-900/40" : "border-white/10 bg-slate-800 hover:bg-slate-700"}`}
        >
          <div className="font-semibold">{l.title}</div>
          <div className="text-xs text-slate-400">{l.desc}</div>
        </button>
      ))}
    </div>
  );

  const toggles = (
    <div className="flex flex-wrap gap-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Körlärarens röst</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={quizOn} onChange={(e) => setQuizOn(e.target.checked)} /> Teorifrågor</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={help} onChange={(e) => setHelp(e.target.checked)} /> Regelhjälp</label>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none text-white">
      <div ref={mountRef} className="absolute inset-0" />

      {/* Bilens ram och speglar */}
      <div ref={frameRef} className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect x="0" y="0" width="100" height="3" fill="#0b0c0e" />
          <polygon points="0,0 7,0 2.5,52 0,58" fill="#0b0c0e" />
          <polygon points="100,0 96,0 99.5,50 100,53" fill="#0b0c0e" />
        </svg>
        <div className="absolute" style={{ left: `${(MR.x + MR.w / 2) * 100}%`, top: 0, width: 8, marginLeft: -4, height: `${MR.y * 100}%`, background: "#111" }} />
        <div className="absolute" style={mirrorStyle(MR, "6px")} />
        <div className="absolute" style={mirrorStyle(ML, "14px")} />
        <div className="absolute" style={mirrorStyle(MRS, "14px")} />
      </div>

      {/* Navigering */}
      <div ref={navRef} className="pointer-events-none absolute left-3 top-3 hidden items-center gap-2 rounded-xl bg-slate-900/85 px-3 py-2 text-sm font-semibold shadow-lg">
        <svg ref={navArrowRef} viewBox="0 0 24 24" className="h-6 w-6 transition-transform"><path d="M12 3 L19 11 H14 V21 H10 V11 H5 Z" fill="#38bdf8" /></svg>
        <span ref={navTextRef} />
      </div>

      {/* Regelpanel */}
      {phase === "running" && panel && !quiz && (
        <div className="pointer-events-none absolute left-3 w-[min(330px,46vw)] rounded-xl bg-slate-900/88 p-3 text-xs shadow-xl" style={{ top: 60 }}>
          <div className="text-sm font-bold text-sky-300">{panel.title}</div>
          <div className="mt-1 text-slate-200">{panel.rule}</div>
          {panel.checks.length > 0 && (
            <ul className="mt-2 space-y-1">
              {panel.checks.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className={c.ok === true ? "text-green-400" : c.ok === false ? "text-amber-400" : "text-slate-400"}>{c.ok === true ? "✔" : c.ok === false ? "○" : "•"}</span>
                  <span>{c.t}</span>
                </li>
              ))}
            </ul>
          )}
          {panel.extra.length > 0 && <div className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-slate-300">{panel.extra.map((e, i) => <div key={i}>{e}</div>)}</div>}
        </div>
      )}

      {/* Parkeringskamera */}
      {phase === "running" && mode === "maneuver" && (
        <div className="pointer-events-none absolute right-3 rounded-xl bg-slate-900/85 p-2 shadow-xl" style={{ top: "14%" }}>
          <div className="mb-1 text-[11px] text-slate-300">Parkeringskamera</div>
          <canvas ref={mapRef} width={200} height={200} className="rounded-lg" />
        </div>
      )}

      {/* Instrumentbräda */}
      <div ref={dashRef} className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: "28%" }}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,22 Q50,0 100,22 L100,100 L0,100 Z" fill="#141518" />
          <path d="M0,22 Q50,0 100,22" stroke="#2a2c31" strokeWidth="1.2" fill="none" />
        </svg>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3" style={{ bottom: "4vh", height: "18vh" }}>
          <svg ref={blinkLRef} viewBox="0 0 20 20" style={{ width: "4vh", opacity: 0.15 }}><polygon points="2,10 11,3 11,7 18,7 18,13 11,13 11,17" fill="#22c55e" /></svg>
          <svg viewBox="0 0 100 100" style={{ height: "18vh", width: "18vh" }}>
            <circle cx="50" cy="50" r="47" fill="#0a0b0d" stroke="#2d3036" strokeWidth="2" />
            {ticks.map((k) => {
              const a = ((-120 + (k / 120) * 240) * Math.PI) / 180;
              const major = k % 20 === 0;
              const r1 = major ? 37 : 40;
              return (
                <g key={k}>
                  <line x1={50 + r1 * Math.sin(a)} y1={50 - r1 * Math.cos(a)} x2={50 + 44 * Math.sin(a)} y2={50 - 44 * Math.cos(a)} stroke="#d9dde3" strokeWidth={major ? 1.6 : 0.8} />
                  {major && <text x={50 + 30 * Math.sin(a)} y={50 - 30 * Math.cos(a) + 2.5} fill="#d9dde3" fontSize="7" textAnchor="middle" fontFamily="system-ui">{k}</text>}
                </g>
              );
            })}
            <g ref={needleRef} transform="rotate(-120 50 50)"><line x1="50" y1="56" x2="50" y2="12" stroke="#ff4d2e" strokeWidth="2.2" strokeLinecap="round" /></g>
            <circle cx="50" cy="50" r="5" fill="#222" stroke="#444" />
            <text ref={speedRef} x="50" y="76" fill="#fff" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="system-ui">0</text>
            <text x="50" y="85" fill="#9aa1ab" fontSize="5.5" textAnchor="middle" fontFamily="system-ui">km/h</text>
          </svg>
          <div className="rounded-md bg-black/60 px-2 font-mono font-bold text-sky-300" style={{ fontSize: "2.4vh" }}><span ref={gearRef}>D</span></div>
          <svg ref={blinkRRef} viewBox="0 0 20 20" style={{ width: "4vh", opacity: 0.15 }}><polygon points="18,10 9,3 9,7 2,7 2,13 9,13 9,17" fill="#22c55e" /></svg>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2" style={{ width: "62vh", height: "62vh", bottom: "-31vh" }}>
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <g ref={wheelRef}>
              <circle cx="50" cy="50" r="45" fill="none" stroke="#1b1c1f" strokeWidth="7" />
              <rect x="10" y="47" width="28" height="6" rx="3" fill="#1b1c1f" />
              <rect x="62" y="47" width="28" height="6" rx="3" fill="#1b1c1f" />
              <circle cx="50" cy="50" r="11" fill="#222428" stroke="#33363c" />
            </g>
          </svg>
        </div>
      </div>

      {/* Blinkers och kontroller */}
      {phase === "running" && (
        <>
          <button ref={btnLRef} onClick={() => api.current?.blink("left")} className="absolute left-3 bottom-3 rounded-2xl px-4 py-3 text-left font-semibold shadow-xl border border-white/20">
            <div className="text-base md:text-lg">⬅ Blinkers vänster</div>
            <div className="text-xs opacity-70">Tangent Q</div>
          </button>
          <button ref={btnRRef} onClick={() => api.current?.blink("right")} className="absolute right-3 bottom-3 rounded-2xl px-4 py-3 text-right font-semibold shadow-xl border border-white/20">
            <div className="text-base md:text-lg">Blinkers höger ➡</div>
            <div className="text-xs opacity-70">Tangent E</div>
          </button>
          <div className="pointer-events-none absolute right-3 top-3 rounded-xl bg-slate-900/80 px-3 py-2 text-xs leading-relaxed text-right">
            {running && <div className="font-semibold text-sky-300">{running.title} · {running.cond}</div>}
            {!touch && (
              <>
                ↑ gas · ↓ broms<br />
                {mode === "town" ? "← → eller A / D titta åt sidan" : "← → styr · A / D titta åt sidan"}<br />
                mellanslag: titta bakåt<br />
                Q / E blinkers{mode === "maneuver" ? " · R framåt/back" : ""}
              </>
            )}
          </div>
          {mode === "maneuver" && (
            <button onClick={() => api.current?.quit()} className="absolute left-1/2 -translate-x-1/2 top-3 rounded-xl bg-slate-800/90 px-3 py-2 text-xs">Avsluta manövreringen</button>
          )}
        </>
      )}

      {touch && phase === "running" && (
        <>
          <div className="absolute left-3 flex flex-wrap gap-2 w-40" style={{ bottom: "17%" }}>
            {mode === "maneuver" && (
              <>
                <button {...hold("left")} className="touch-none w-16 h-14 rounded-2xl bg-white/20 text-lg">◀</button>
                <button {...hold("right")} className="touch-none w-16 h-14 rounded-2xl bg-white/20 text-lg">▶</button>
              </>
            )}
            <button {...hold("lookL")} className="touch-none w-16 h-12 rounded-2xl bg-white/15 text-xs">Titta vänster</button>
            <button {...hold("lookR")} className="touch-none w-16 h-12 rounded-2xl bg-white/15 text-xs">Titta höger</button>
            <button {...hold("back")} className="touch-none w-[8.5rem] h-10 rounded-2xl bg-white/15 text-xs">Titta bakåt</button>
          </div>
          <div className="absolute right-3 flex gap-2" style={{ bottom: "17%" }}>
            {mode === "maneuver" && <button onClick={() => api.current?.gear()} className="w-14 h-16 rounded-2xl bg-sky-700/70 font-bold">R/D</button>}
            <button {...hold("down")} className="touch-none w-16 h-16 rounded-2xl bg-red-600/60 font-semibold">Broms</button>
            <button {...hold("up")} className="touch-none w-16 h-20 rounded-2xl bg-green-600/60 font-semibold">Gas</button>
          </div>
        </>
      )}

      {/* Körläraren */}
      {msg && phase === "running" && !quiz && (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-[min(560px,90%)]" style={{ bottom: "30%" }}>
          <div className={`rounded-xl px-4 py-3 text-sm md:text-base shadow-xl border-l-4 ${msg.kind === "bad" ? "bg-red-950/90 border-red-500" : msg.kind === "good" ? "bg-green-950/90 border-green-500" : msg.kind === "eco" ? "bg-amber-950/90 border-amber-400" : "bg-slate-900/90 border-sky-400"}`}>
            <span className="font-semibold opacity-80">{msg.kind === "eco" ? "Miljötips: " : "Körläraren: "}</span>{msg.text}
          </div>
        </div>
      )}

      {/* Teorifråga */}
      {quiz && phase === "running" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Teorifråga</div>
            {quiz.sign && <img src={signImages[quiz.sign]} alt="" className="mx-auto h-28 w-28 object-contain" />}
            <p className="font-semibold">{quiz.q}</p>
            <div className="space-y-2">
              {quiz.options.map((o, i) => {
                const picked = quizPick !== null;
                const style = !picked ? "bg-slate-800 hover:bg-slate-700" : i === quiz.correct ? "bg-green-700" : i === quizPick ? "bg-red-700" : "bg-slate-800 opacity-60";
                return <button key={i} disabled={picked} onClick={() => setQuizPick(i)} className={`w-full rounded-xl px-4 py-3 text-left text-sm ${style}`}>{o}</button>;
              })}
            </div>
            {quizPick !== null && (
              <>
                <p className="text-sm text-slate-300">{quiz.explain}</p>
                <button onClick={() => { api.current?.resume(quizPick === quiz.correct); setQuiz(null); }} className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-semibold">Fortsätt köra</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Start och resultat */}
      {phase !== "running" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 p-6 space-y-4 shadow-2xl my-auto">
            {phase === "start" ? (
              <>
                <h1 className="text-2xl font-bold">Övningskörning inför körkortet</h1>
                <p className="text-sm text-slate-300">
                  Välj en lektion eller slumpa. Varje gång byggs en ny stad med nya korsningar, skyltar, trafikanter och väder. Läraren säger bara vart du ska köra, inte vad som gäller, så du måste själv läsa skyltarna och vara uppmärksam.
                </p>
                <div className="rounded-xl bg-slate-800 p-3 text-xs space-y-1 text-slate-300">
                  <p><b>↑ / ↓</b> gas och broms · <b>Q / E</b> blinkers vänster/höger</p>
                  <p><b>A / D</b> eller <b>← / →</b> titta åt sidan och kolla döda vinkeln · <b>mellanslag</b> titta bakåt</p>
                  <p>Vid parkeringen: <b>← / →</b> styr och <b>R</b> växlar mellan framåt och back</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-400">{summary?.lesson} · {summary?.cond}</div>
                <h2 className={`text-xl font-bold ${phase === "crashed" ? "text-red-400" : "text-green-400"}`}>{summary?.reason}</h2>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.faults.length}</div><div className="text-xs text-slate-400">körfel</div></div>
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{summary?.right}/{summary?.total}</div><div className="text-xs text-slate-400">rätt på teorin</div></div>
                  <div className="rounded-xl bg-slate-800 p-3"><div className="text-2xl font-bold">{Math.max(0, 100 - (summary?.eco.length ?? 0) * 15)}</div><div className="text-xs text-slate-400">miljöpoäng</div></div>
                </div>
                {summary?.maneuver && <p className="text-sm text-sky-300">{summary.maneuver}</p>}
                {summary && summary.faults.length > 0 ? (
                  <div>
                    <p className="text-sm font-semibold mb-1">Att öva på</p>
                    <ul className="text-sm text-slate-300 space-y-1">{countList(summary.faults).map(([f, n]) => <li key={f}>• {f}{n > 1 ? ` (${n} gånger)` : ""}</li>)}</ul>
                  </div>
                ) : <p className="text-sm text-slate-300">Inga körfel. Snyggt kört!</p>}
                {summary && summary.eco.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold mb-1">Miljöanpassad körning</p>
                    <ul className="text-sm text-slate-300 space-y-1">{countList(summary.eco).map(([f, n]) => <li key={f}>• {f}{n > 1 ? ` (${n} gånger)` : ""}</li>)}</ul>
                  </div>
                )}
                <button onClick={() => startLesson(randomLesson(lessonId))} className="w-full rounded-xl bg-green-600 hover:bg-green-500 py-3 font-semibold">Nästa lektion: nytt scenario</button>
                <p className="text-sm font-semibold pt-2">Eller välj själv</p>
              </>
            )}
            {lessonPicker}
            {toggles}
            <div className="flex gap-2">
              <button onClick={() => startLesson(lessonId)} className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-semibold">Starta vald lektion</button>
              <button onClick={() => startLesson(randomLesson())} className="flex-1 rounded-xl bg-slate-700 hover:bg-slate-600 py-3 font-semibold">Slumpa lektion</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}