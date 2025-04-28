#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 创建目录（如果不存在）
 * @param {string} dirPath - 要创建的目录路径
 */
function createDirIfNotExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`创建目录: ${dirPath}`);
    }
}

/**
 * 将错误信息写入错误日志
 * @param {string} message - 错误信息
 */
function logError(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync('error.log', logMessage);
    console.error(message);
}

/**
 * 从package.json文件中获取包名称和版本信息
 * @param {string} packageJsonPath - package.json文件的路径
 * @returns {Object|null} - 包含name和version的对象，如果无法解析则返回null
 */
function getPackageInfo(packageJsonPath) {
    try {
        const packageData = fs.readFileSync(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageData);

        return {
            name: packageJson.name || 'unknown',
            version: packageJson.version || 'unknown'
        };
    } catch (error) {
        return null;
    }
}

/**
 * 递归获取node_modules目录中的所有包信息
 * @param {string} nodeModulesPath - node_modules目录的路径
 * @param {Set} processedPackages - 已处理过的包名和版本组合的集合，防止重复
 * @param {number} depth - 递归深度，用于限制递归层级
 * @returns {Array} - 包含所有包信息的数组
 */
function getAllPackages(nodeModulesPath, processedPackages = new Set(), depth = 0, maxDepth = 10) {
    const packages = [];

    if (depth > maxDepth) {
        console.log(`达到最大递归深度(${maxDepth})，停止进一步查找`);
        return packages;
    }

    if (!fs.existsSync(nodeModulesPath)) {
        if (depth === 0) {
            console.error('node_modules目录不存在！');
        }
        return packages;
    }

    // 获取node_modules中的所有条目
    try {
        const entries = fs.readdirSync(nodeModulesPath);

        for (const entry of entries) {
            // 处理@开头的命名空间包
            if (entry.startsWith('@')) {
                const namespacePath = path.join(nodeModulesPath, entry);
                if (fs.statSync(namespacePath).isDirectory()) {
                    try {
                        const namespaceEntries = fs.readdirSync(namespacePath);

                        for (const namespaceEntry of namespaceEntries) {
                            const packagePath = path.join(namespacePath, namespaceEntry);
                            if (fs.statSync(packagePath).isDirectory()) {
                                const packageJsonPath = path.join(packagePath, 'package.json');
                                const packageInfo = getPackageInfo(packageJsonPath);

                                if (packageInfo) {
                                    const packageKey = `${packageInfo.name}@${packageInfo.version}`;
                                    if (!processedPackages.has(packageKey)) {
                                        packages.push(packageInfo);
                                        processedPackages.add(packageKey);

                                        // 检查此包是否有自己的node_modules目录
                                        const nestedNodeModules = path.join(packagePath, 'node_modules');
                                        if (fs.existsSync(nestedNodeModules)) {
                                            const nestedPackages = getAllPackages(nestedNodeModules, processedPackages, depth + 1, maxDepth);
                                            packages.push(...nestedPackages);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        logError(`读取命名空间 ${namespacePath} 出错: ${error.message}`);
                    }
                }
            } else if (entry !== '.bin' && entry !== '.cache' && entry !== '.package-lock.json') {
                // 处理常规包，排除特殊目录
                const packagePath = path.join(nodeModulesPath, entry);
                if (fs.statSync(packagePath).isDirectory()) {
                    const packageJsonPath = path.join(packagePath, 'package.json');
                    const packageInfo = getPackageInfo(packageJsonPath);

                    if (packageInfo) {
                        const packageKey = `${packageInfo.name}@${packageInfo.version}`;
                        if (!processedPackages.has(packageKey)) {
                            packages.push(packageInfo);
                            processedPackages.add(packageKey);

                            // 检查此包是否有自己的node_modules目录
                            const nestedNodeModules = path.join(packagePath, 'node_modules');
                            if (fs.existsSync(nestedNodeModules)) {
                                const nestedPackages = getAllPackages(nestedNodeModules, processedPackages, depth + 1, maxDepth);
                                packages.push(...nestedPackages);
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        logError(`读取目录 ${nodeModulesPath} 出错: ${error.message}`);
    }

    return packages;
}

/**
 * 生成npm包可能的.tgz文件名
 * @param {string} name - 包名
 * @param {string} version - 版本号
 * @returns {string[]} - 可能的文件名列表
 */
function getPossiblePackageFilenames(name, version) {
    const normalizedName = name.replace('@', '').replace('/', '-');
    const nameWithoutScope = name.includes('/') ? name.split('/')[1] : name;

    return [
        `${normalizedName}-${version}.tgz`,
        `${nameWithoutScope}-${version}.tgz`,
        `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
    ];
}

/**
 * 检查pkg目录中是否已存在指定包的.tgz文件
 * @param {string} name - 包名
 * @param {string} version - 版本号
 * @param {string} outputDir - 输出目录路径
 * @returns {boolean} - 如果文件已存在则返回true，否则返回false
 */
function isPackageAlreadyDownloaded(name, version, outputDir) {
    const possibleFilenames = getPossiblePackageFilenames(name, version);

    for (const filename of possibleFilenames) {
        const filePath = path.join(outputDir, filename);
        if (fs.existsSync(filePath)) {
            return true;
        }
    }

    return false;
}

/**
 * 使用npm pack命令创建.tgz包文件
 * @param {Object} packageInfo - 包信息对象，包含name和version
 * @param {string} outputDir - 输出目录路径
 * @param {number} current - 当前处理的包的序号
 * @param {number} total - 总包数
 * @returns {boolean} - 操作是否成功
 */
function createPackageFile(packageInfo, outputDir, current, total) {
    const { name, version } = packageInfo;
    const progress = `[${current}/${total}]`;

    // 检查包是否已经下载
    if (isPackageAlreadyDownloaded(name, version, outputDir)) {
        console.log(`${progress} 跳过包 ${name}@${version} - 已经存在`);
        return true;
    }

    try {
        console.log(`${progress} 正在处理包: ${name}@${version}`);

        // 使用npm pack命令
        const command = `npm pack ${name}@${version}`;
        const output = execSync(command, { cwd: outputDir, encoding: 'utf8', timeout: 60000 });  // 增加超时限制为60秒

        console.log(`${progress} 成功创建包: ${output.trim()}`);
        return true;
    } catch (error) {
        logError(`${progress} 为 ${name}@${version} 创建包文件失败: ${error.message}`);
        return false;
    }
}

/**
 * 分析项目的package.json获取直接依赖
 * @returns {Object} 包含直接依赖信息的对象
 */
function getProjectDirectDependencies() {
    const projectPackageJsonPath = path.join(process.cwd(), 'package.json');

    if (!fs.existsSync(projectPackageJsonPath)) {
        console.log('找不到项目的package.json文件');
        return {};
    }

    try {
        const packageJson = JSON.parse(fs.readFileSync(projectPackageJsonPath, 'utf8'));
        return {
            dependencies: packageJson.dependencies || {},
            devDependencies: packageJson.devDependencies || {},
            peerDependencies: packageJson.peerDependencies || {},
            optionalDependencies: packageJson.optionalDependencies || {}
        };
    } catch (error) {
        logError(`读取项目package.json失败: ${error.message}`);
        return {};
    }
}

/**
 * 主函数
 */
function main() {
    const currentDateTime = '2025-04-27 10:29:54';  // 您提供的时间
    console.log(`===== NPM包文件生成工具 =====`);
    console.log(`开始时间: ${currentDateTime}`);
    console.log(`用户: moselikk`);

    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    const outputDir = path.join(process.cwd(), 'pkg');

    // 创建输出目录
    createDirIfNotExists(outputDir);

    // 初始化错误日志（如果存在则清空）
    if (fs.existsSync('error.log')) {
        fs.unlinkSync('error.log');
    }

    // 获取项目直接依赖
    const directDeps = getProjectDirectDependencies();
    console.log(`项目直接依赖数量: ${Object.keys(directDeps.dependencies).length} 个正常依赖, ` +
        `${Object.keys(directDeps.devDependencies).length} 个开发依赖`);

    // 递归获取所有包信息
    console.log('正在递归读取node_modules中的所有包信息(包括嵌套依赖)...');
    const packages = getAllPackages(nodeModulesPath);

    if (packages.length === 0) {
        console.log('没有找到包信息，请确认node_modules目录存在且包含npm包');
        return;
    }

    // 去重并排序包
    const uniquePackages = Array.from(new Map(
        packages.map(pkg => [`${pkg.name}@${pkg.version}`, pkg])
    ).values()).sort((a, b) => a.name.localeCompare(b.name));

    // 保存包信息到JSON文件
    const summary = {
        totalPackages: uniquePackages.length,
        directDependencies: Object.keys(directDeps.dependencies).length,
        devDependencies: Object.keys(directDeps.devDependencies).length,
        generatedAt: currentDateTime,
        packages: uniquePackages
    };

    fs.writeFileSync('packages-summary.json', JSON.stringify(summary, null, 2));
    console.log(`已生成包信息文件: packages-summary.json (共 ${uniquePackages.length} 个包)`);

    console.log(`\n开始为 ${uniquePackages.length} 个包创建.tgz文件...`);

    // 跟踪成功和失败的数量
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    // 为每个包创建.tgz文件
    uniquePackages.forEach((pkg, index) => {
        // 检查包是否已经存在
        if (isPackageAlreadyDownloaded(pkg.name, pkg.version, outputDir)) {
            console.log(`[${index + 1}/${uniquePackages.length}] 跳过包 ${pkg.name}@${pkg.version} - 已经存在`);
            skippedCount++;
            successCount++; // 将跳过的包也计入成功数
        } else {
            const success = createPackageFile(pkg, outputDir, index + 1, uniquePackages.length);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
        }
    });

    // 输出总结
    console.log('\n===== 总结 =====');
    console.log(`总包数: ${uniquePackages.length}`);
    console.log(`成功: ${successCount}`);
    console.log(`跳过的包(已存在): ${skippedCount}`);
    console.log(`失败: ${failCount}`);

    if (failCount > 0) {
        console.log(`详细错误信息请查看 error.log`);
    }

    console.log(`\n结束时间: ${new Date().toISOString()}`);
}

// 执行主函数
main();