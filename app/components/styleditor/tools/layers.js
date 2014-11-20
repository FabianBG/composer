/* 
 * (c) 2014 Boundless, http://boundlessgeo.com
 */
angular.module('gsApp.styleditor.layers', [])
.directive('styleEditorLayers', ['$log',
    function($log) {
      return {
        restrict: 'EA',
        scope: {
          click: '='
        },
        template:
          '<li ng-click="click()">' +
            '<i class="icon-stack"></i>' +
            '<span>Layers</span>' +
          '</li>',
        replace: true
      };
    }]);
