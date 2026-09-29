/**
 * Proxys de confiance placés devant l'application.
 *
 * Derrière un reverse proxy — Caddy sur la VPS, le routeur de Railway —
 * chaque requête arrive depuis l'adresse du proxy. Sans ce réglage, `req.ip`
 * vaut cette adresse pour tout le monde : le limiteur de débit range alors
 * tous les visiteurs dans un seul compteur, et quelques tentatives de
 * connexion suffisent à fermer l'authentification au site entier.
 *
 * **Un nombre est la forme à préférer** : « 1 » fait confiance au seul saut
 * qui précède l'application, et l'adresse retenue est celle que ce proxy a
 * vue. Une liste de plages (« loopback, uniquelocal ») convient aussi.
 *
 * « true » est refusé : il ferait confiance à toute la chaîne, donc au
 * X-Forwarded-For envoyé par le client lui-même. N'importe qui choisirait
 * alors son adresse, et contournerait le limiteur en en changeant à chaque
 * essai.
 */
// Le type mixte est celui qu'attend Express : un nombre compte des sauts, une
// chaîne liste des plages d'adresses — « 1 » en chaîne serait lu comme une
// adresse IP invalide. Tout ramener à un seul type obligerait l'appelant à le
// retraduire.
// eslint-disable-next-line sonarjs/function-return-type
export function proxyDeConfiance(
  valeur: string | undefined,
): number | string | false {
  const brute = valeur?.trim();

  if (!brute || brute === 'false') {
    return false;
  }

  if (brute === 'true') {
    throw new Error(
      'TRUST_PROXY=true ferait confiance au X-Forwarded-For forgé par le ' +
        'client : chacun choisirait son adresse et contournerait la ' +
        'limitation de débit. Indiquer le nombre de proxys devant ' +
        "l'application, en général 1.",
    );
  }

  if (/^\d+$/.test(brute)) {
    return Number(brute);
  }

  return brute;
}
