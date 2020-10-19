import * as fs from 'fs';
import { ThermostatState } from './thermostat';

export class FileSystem {
  /**
   * Returns true if the path exists, promise will be rejected on error.
   * @param {string} path The path to verify.
   * @returns {Promise<boolean>}
   * @memberof FileSystem
   */
  public exists(path: string): Promise<boolean> {
    console.debug(`FileSystem.exists() -- start`);
    return new Promise<boolean>((resolve: Function, reject: Function) => {
      try {
        fs.exists(path, (exists: boolean) => {
          console.debug(`FileSystem.exists() -- resolved to ${exists}`);
          resolve(exists);
        });
      } catch (err) {
        console.error(`FileSystem.exists() -- err ${err}`);
        reject(err);
      }
    });
  }

  /**
   *
   * @param {string} path The path to the file.
   * @memberof FileSystem
   */
  public readFile(path: string): Promise<Buffer> {
    console.debug(`FileSystem.readFile() -- start`);
    return new Promise<any>((resolve, reject) => {
      fs.readFile(path, (err, data) => {
        if (err) reject(err);
        console.debug(`FileSystem.readFile() -- ok`);
        resolve(data);
      });
    });
  }

  /**
   * Writes text to a file and returns true if the operation is completed.
   * @param {string} path The path to the file.
   * @param {string} text The text to write to file
   * @returns {Promise<boolean>}
   * @memberof FileSystem
   */
  public writeFile(path: string, bytes: Buffer): Promise<boolean> {
    console.debug(`FileSystem.writeFile() -- start`);
    return new Promise<any>((resolve, reject) => {
      try {
        fs.writeFile(path, bytes, (err) => {
          if (err) resolve(false);
          console.debug(`FileSystem.writeFile() -- ok`);
          resolve(true);
        });
      } catch (err) {
        console.error(`FileSystem.writeFile() -- err ${err}`);
        reject(err);
      }
    });
  }

  /**
   * Appends text to a file and returns true if the operation is completed.
   * @param {string} path The path to the file.
   * @param {string} text The text to append to file
   * @returns {Promise<boolean>}
   * @memberof FileSystem
   */
  public writeAppendFile(path: string, bytes: Buffer): Promise<boolean> {
    console.debug(`FileSystem.writeAppendFile() -- start`);
    return new Promise<any>((resolve, reject) => {
      try {
        fs.appendFile(path, bytes, (err) => {
          if (err) resolve(false);
          console.debug(`FileSystem.writeAppendFile() -- ok`);
          resolve(true);
        });
      } catch (err) {
        console.error(`FileSystem.writeAppendFile() -- err ${err}`);
        reject(err);
      }
    });
  }

  /**
   * Deletes the file or folder at a given path
   * @param {string} path The path to the file or folder.
   * @returns {Promise<boolean>}
   * @memberof FileSystem
   */
  public delete(path: string): Promise<boolean> {
    console.debug(`FileSystem.delete() -- start`);
    return new Promise<boolean>((resolve: Function, reject: Function) => {
      try {
        fs.unlink(path, (err) => {
          if (err) return resolve(false);
          console.debug(`FileSystem.delete() -- ok`);
          resolve(true);
        });
      } catch (err) {
        console.error(`FileSystem.delete() -- err ${err}`);
        reject(err);
      }
    });
  }

  public toBuffer(text: string): Buffer {
    return Buffer.from(text);
  }

  public toJson(object: any): string {
    const obj = JSON.stringify(object);
    return obj;
  }

  public fromJson(text: string): any {
    const obj = JSON.parse(text);
    return obj;
  }



  public checkBuffer(buffer: Buffer): IConfig {
    if (buffer) {
      console.debug(`checkBuffer() -- buffer is not null.`);
      const configText: string = buffer.toString();
      try {
        const configObj: IConfig = JSON.parse(configText);
        console.debug(`checkBuffer() -- buffer is JSON.`);
        if (configObj && configObj.hostname && configObj.port && configObj.thermostatState) {
          console.debug(`checkBuffer() -- config has needed values.`);
          return configObj;
        }
        console.debug(`checkBuffer() -- config does not contain required keys.`);
      } catch (e) {
        console.debug(`checkBuffer() -- buffer not JSON, ${e}.`);
      }
    }

    return null;
  }
}

export interface IConfig {
  hostname: string;
  port: number;
  thermostatState: ThermostatState;
}