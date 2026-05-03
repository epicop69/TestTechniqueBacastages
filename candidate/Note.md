# Note.md — Bugs identifiés et choix techniques

---

# Exercice 1 — Débogage

## Bug 1 — `GET /api/sessions/:id` : réponse 200 au lieu de 404

| Champ | Détail |
|-------|--------|
| **Endpoint** | `GET /api/sessions/:id` |
| **Fichier** | `sessions.router.ts` |
| **Ligne** | 49 |

**Code problématique :**
```ts
res.json({ data: session });
```

**Problème :**
- Si la session n'existe pas, Prisma retourne `null`
- Le code renvoyait un `200` avec `{ data: null }` au lieu d'un `404`

**Impact :**
Le client ne reçoit pas d'erreur claire, ce qui peut porter à confusion.

**Correction :**
```ts
if (!session) return res.status(404).json({ error: 'Session introuvable.' });
res.json({ data: session });
```

**Explication :**
On vérifie si `session` est `null` avant de répondre. Si c'est le cas, on renvoie un `404`. Cela respecte la sémantique HTTP — un `404` signifie explicitement "ressource non trouvée".

---

## Bug 2 — `POST /api/sessions/:id/participants` : `allocatedPlaces` jamais incrémenté

| Champ | Détail |
|-------|--------|
| **Endpoint** | `POST /api/sessions/:id/participants` |
| **Fichier** | `participants.router.ts` |
| **Lignes** | 34 à 46 |

**Code problématique :**
```ts
if (session.allocatedPlaces >= session.maxCapacity) {
  return res.status(409).json({ error: 'Cette session est complète.' });
}

const participant = await prisma.participant.create({
  data: {
    sessionId,
    firstName,
    lastName,
    birthDate: new Date(birthDate),
    originSchoolId: originSchoolId ?? null,
  },
});
```

**Problème :**
- Le code vérifie si `allocatedPlaces >= maxCapacity` pour bloquer les inscriptions
- Mais `allocatedPlaces` n'est jamais incrémenté après la création d'un participant
- La session ne sera donc jamais considérée comme pleine

**Impact :**
On peut inscrire un nombre illimité de participants : la capacité maximale n'est jamais respectée.

**Correction :**
Après `prisma.participant.create(...)`, ajouter :
```ts
await prisma.session.update({
  where: { id: sessionId },
  data: { allocatedPlaces: { increment: 1 } },
});
```

**Explication :**
Après chaque création de participant, on incrémente `allocatedPlaces` en base. Ainsi, le prochain appel lira la valeur à jour et le check `allocatedPlaces >= maxCapacity` fonctionnera correctement.

---

## Bug 3 — `GET /api/sessions` : requêtes N+1

| Champ | Détail |
|-------|--------|
| **Endpoint** | `GET /api/sessions` |
| **Fichier** | `sessions.router.ts` |
| **Lignes** | 18 à 28 |

**Code problématique :**
```ts
const result = await Promise.all(
  sessions.map(async (session) => {
    const school = await prisma.school.findUnique({
      where: { id: session.hostSchoolId },
    });
    const participantCount = await prisma.participant.count({
      where: { sessionId: session.id },
    });
    return { ...session, school, participantCount };
  })
);
```

**Problème :**
- Pour chaque session, 2 requêtes supplémentaires sont effectuées (école + count participants)
- Avec 20 sessions : 41 requêtes au lieu de 1

**Impact :**
Perte en performance significative. Sur une base plus grande ou un trafic élevé, cela ralentit fortement l'API.

**Correction :**
```ts
const sessions = await prisma.session.findMany({
  include: { hostSchool: true, _count: { select: { participants: true } } },
});
```

**Explication :**
Prisma génère une seule requête SQL avec des jointures. `include: { hostSchool: true }` remplace le `findUnique` sur l'école, et `_count: { select: { participants: true } }` remplace le `participant.count`.

---

# Exercice 2 — Implémentation de `GET /api/sessions/:id/stats`

## Choix techniques

- **2 requêtes Prisma uniquement** (pas de N+1) :
  - Une pour vérifier l'existence de la session
  - Une pour récupérer tous les participants avec `include` (`convention` + `originSchool`)
- **`byStatus`** : calculé en JS avec `.filter()` sur le tableau de participants
- **`conventionRate`** : division avec protection contre la division par zéro, arrondi à 2 décimales avec `Math.round(rate * 100) / 100`
- **`topOriginSchools`** : regroupement par école via une `Map`, tri décroissant par count, `slice(0, 3)` pour les 3 premiers
