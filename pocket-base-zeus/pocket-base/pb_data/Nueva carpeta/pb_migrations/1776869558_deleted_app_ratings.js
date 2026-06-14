/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3541738736");

  return app.delete(collection);
}, (app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != \"\" && @request.auth.id = user",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.id = user",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_397042215",
        "hidden": false,
        "id": "relation3379458255",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "app",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "_pb_users_auth_",
        "hidden": false,
        "id": "relation2375276105",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "user",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "number3632866850",
        "max": 5,
        "min": 1,
        "name": "rating",
        "onlyInt": true,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_3541738736",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_Kq7OKphPRQ` ON `app_ratings` (\n  `app`,\n  `user`\n)"
    ],
    "listRule": "",
    "name": "app_ratings",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\" && @request.auth.id = user",
    "viewRule": ""
  });

  return app.save(collection);
})
