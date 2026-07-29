import { Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'assert';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';
import type { HealthStatus } from '../../src/app.service';

let reponse: HealthStatus;

// Les définitions restent en anglais (Given/When/Then) : Cucumber fait
// correspondre les mots-clés localisés du .feature automatiquement.
When("j'interroge l'état de santé de l'API", function () {
  reponse = new AppController(new AppService()).getHealth();
});

Then('le statut retourné est {string}', function (statut: string) {
  assert.equal(reponse.status, statut);
});

Then('la réponse contient un horodatage valide', function () {
  assert.notEqual(new Date(reponse.timestamp).toString(), 'Invalid Date');
});
