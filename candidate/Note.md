# Exercice 1:

## Bug 1:

**endpoint** : GET /api/sessions/:id
**fichier** : 'sessions.router.ts'
**ligne** : 49

```ts
res.json({ data: session });
```

**probleme** :
|-> si la session n'existe pas, Prisma va return null
|-> le code renvoie 200 même avec "  { data: null }  "
|-> On voudrais qu'il renvoie 404

**impact** : Le client ne recoit pas d'erreur claire ce qui peut porter à confusion

**correction** : 

```ts
if (!session) return res.status(404).json({ error: 'Session introuvable.' });
res.json({ data: session });
```

**explication** :
|-> on verifie si session = null avant de return
|-> si c'est le cas on renvoi 404
|-> respect de la sémantique HTTP





## Bug 2:

**endpoint** : POST /api/sessions/:id/participants
**fichier** : 'participants.router.ts'
**ligne** : 34 à 46

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

**probleme** :
|-> Le code va check si "  session.allocatedPlaces >= session.maxCapacity  "
|-> et bloquer la session si elle est pleine
|-> mais allocatedPlaces n'est pas incrémenter
|-> donc la session ne sera jamais pleine

**impact** : On peut inscrire une infinité de participants: la capacité max n'est jamais respectée

**correction** : 

Apres "  prisma.participant.create(...)  ", il faut ajouter
```ts
await prisma.session.update({
  where: { id: sessionId },
  data: { allocatedPlaces: { increment: 1 } },
});
```

**explication** :
|-> Après chaque création de participant, on incrémente allocatedPlaces
|-> de manière à ce que le if fonctionne correctement
|-> et que la capacité max d'une session soit respectée





## Bug 3:

**endpoint** : GET /api/sessions
**fichier** : 'sessions.router.ts'
**ligne** : 18 à 28

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

**probleme** :
|-> A chaque session 2 requêtes vont être faites
|-> Une pour l'école et une pour le count des participants
|-> Il ya 20 sessions donc 41 requêtes en tout au lieu de 1

**impact** : Perte en efficacité/performance, sur une grosse base ca ralentit fortement l'API

**correction** : 

```ts
prisma.session.findMany({
  include: { hostSchool: true, _count: { select: { participants: true } } }
})
```

**explication** :
|-> On regroupe les 41 requêtes en une seule (include + _count)
|-> Les jointures vont augmenter l'efficacité

# Exercice 2:

**Choix techniques**:
|-> 2 requêtes
    |-> Une pour la session
    |-> Une pour les participants (avec include)
|-> calcul de byStatus en JS avec .filter
|-> Math.round pour arrondir conventionRate
|-> regroupement avec Map + tri + slice pour topOriginSchools