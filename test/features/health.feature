# language: fr
Fonctionnalité: Santé de l'API
  Afin de superviser la plateforme
  En tant qu'outil de monitoring
  Je veux pouvoir interroger l'état de l'API

  Scénario: L'API répond qu'elle est opérationnelle
    Quand j'interroge l'état de santé de l'API
    Alors le statut retourné est "ok"
    Et la réponse contient un horodatage valide
